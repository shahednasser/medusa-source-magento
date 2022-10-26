import { CurrencyService, Product, ProductCollectionService, ProductService, ProductStatus, ProductVariantService, ShippingProfileService, Store, StoreService, TransactionBaseService, Variant } from '@medusajs/medusa';
import MagentoClientService, { MagentoProductTypes, PluginOptions } from './magento-client';

import { EntityManager } from 'typeorm';

type InjectedDependencies = {
  productService: ProductService;
  magentoClientService: MagentoClientService;
  currencyService: CurrencyService;
  productVariantService: ProductVariantService;
  productCollectionService: ProductCollectionService;
  shippingProfileService: ShippingProfileService;
  storeService: StoreService;
  manager: EntityManager;
}

class MagentoProductService extends TransactionBaseService {
  protected manager_: EntityManager;
  protected transactionManager_: EntityManager;
  protected options_: PluginOptions;
  protected productService_: ProductService;
  protected magentoClientService_: MagentoClientService;
  protected currencyService_: CurrencyService;
  protected productVariantService_: ProductVariantService;
  protected productCollectionService_: ProductCollectionService;
  protected shippingProfileService_: ShippingProfileService;
  protected storeServices_: StoreService;
  protected currencies: string[];
  protected defaultShippingProfileId: string;
  
  constructor(container: InjectedDependencies, options: PluginOptions) {
    super(container);
    this.manager_ = container.manager;
    this.options_ = options;
    this.productService_ = container.productService;
    this.magentoClientService_ = container.magentoClientService;
    this.currencyService_ = container.currencyService;
    this.productVariantService_ = container.productVariantService;
    this.productCollectionService_ = container.productCollectionService;
    this.shippingProfileService_ = container.shippingProfileService;
    this.storeServices_ = container.storeService;

    this.currencies = [];
    this.defaultShippingProfileId = "";
  }

  async create (productData: any): Promise<void> {
    return this.atomicPhase_(async (manager) => {

       //check if product exists
       const existingProduct: Product = await this.productService_
        .withTransaction(manager)
        .retrieveByExternalId(productData.id, {
            relations: ["variants", "options", "images"],
        })
        .catch(() => undefined);

      if (existingProduct) {
        //update the product instead
        return this.update(productData, existingProduct);
      } else {
        //check if it's a variant
        const existingVariant: Variant = await this.productVariantService_
          .withTransaction(manager)
          .retrieveBySKU(productData.sku)
          .catch(() => undefined)

        if (existingVariant) {
          return this.updateVariant(productData, existingVariant);
        }
      }

      //retrieve store's currencies
      await this.getCurrencies();

      const normalizedProduct = this.normalizeProduct(productData);
      normalizedProduct.profile_id = await this.getDefaultShippingProfile();

      if (productData.extension_attributes?.category_links) {
        await this.setCategory(productData.extension_attributes?.category_links, normalizedProduct, manager)
      }

      if (productData.extension_attributes?.configurable_product_options) {
        //retrieve options
        productData.extension_attributes?.configurable_product_options.map((item) => {
          normalizedProduct.options.push(this.normalizeOption(item))
        })
      }

      let productImages = normalizedProduct.images;
      delete normalizedProduct.images;

      //create product
      let product = await this.productService_
        .withTransaction(manager)
        .create(normalizedProduct);

      if (productData.extension_attributes?.configurable_product_links) {
        //insert the configurable product's simple products as variants
        //re-retrieve product with options
        product = await this.productService_
          .withTransaction(manager)
          .retrieve(product.id, {
            relations: ['options']
          });
  
        //attached option id to normalized options
        normalizedProduct.options = normalizedProduct.options.map((option) => {
          const productOption = product.options.find((o) => o.title === option.title);
          
          return {
            ...option,
            id: productOption.id
          }
        })

        //retrieve simple products as variants
        const variants = await this.magentoClientService_
          .retrieveSimpleProductsAsVariants(productData.extension_attributes?.configurable_product_links);
        
        for (let v of variants) {
          const variantData = this.normalizeVariant(v, normalizedProduct.options)
          await this.productVariantService_
            .withTransaction(manager)
            .create(product.id, variantData)

          if (v.media_gallery_entries) {
            //update products images with variant's images
            productImages.push(...v.media_gallery_entries.map((entry) => entry.url));
          }
        }
        
      } else {
        //insert a default variant for a simple product

        const variantData = this.normalizeVariant(productData, []);

        await this.productVariantService_
          .withTransaction(manager)
          .create(product.id, variantData)

      }

      //insert product images
      productImages = [...new Set(productImages)];

      await this.productService_
        .withTransaction(manager)
        .update(product.id, {
          images: productImages
        })
    })
  }

  async update (productData: any, existingProduct: Product): Promise<void> {
    return this.atomicPhase_(async (manager) => {

      //retrieve store's currencies
      await this.getCurrencies();
      
      const normalizedProduct = this.normalizeProduct(productData);
      let productOptions = existingProduct.options;

      if (productData.extension_attributes?.category_links) {
        await this.setCategory(productData.extension_attributes?.category_links, normalizedProduct, manager)
      }

      if (productData.extension_attributes?.configurable_product_options) {
        //retrieve options
        productData.extension_attributes.configurable_product_options.forEach(async (item) => {
          const existingOption = productOptions.find((o) => o.metadata.magento_id == item.id)
          
          if (!existingOption) {
            //add option
            await this.productService_
              .withTransaction(manager)
              .addOption(existingProduct.id, item.label)
          }

          //update option and its values
          const normalizedOption = this.normalizeOption(item)
          delete normalizedOption.values

          await this.productService_
            .withTransaction(manager)
            .updateOption(existingProduct.id, existingOption.id, normalizedOption)
        })
        
        //check if there are options that should be deleted
        const optionsToDelete = productOptions.filter(
          (o) => !productData.extension_attributes?.configurable_product_options.find((magento_option) => magento_option.id == o.metadata.magento_id))

        optionsToDelete.forEach(async (option) => {
          await this.productService_
            .withTransaction(manager)
            .deleteOption(existingProduct.id, option.id)
        })

        //re-retrieve product options
        productOptions = (await this.productService_
        .withTransaction(manager)
        .retrieveByExternalId(productData.id, {
            relations: ["options", "options.values"],
        })).options;
      }

      let productImages = existingProduct.images.map((image) => image.url)

      if (productData.extension_attributes?.configurable_product_links) {
        //attach values to the options
        productOptions = productOptions.map((productOption) => {
          const productDataOption = productData.options.find((o) => productOption.metadata.magento_id == o.id)
          if (productDataOption) {
            productOption.values = this.normalizeOption(productDataOption).values
          }

          return productOption;
        })

        //retrieve simple products as variants
        const variants = await this.magentoClientService_
          .retrieveSimpleProductsAsVariants(productData.extension_attributes.configurable_product_links);
        
        for (let v of variants) {
          const variantData = await this.normalizeVariant(v, productOptions)
          
          //check if variant exists
          const existingVariant = existingProduct.variants.find((variant) => variant.metadata.magento_id === v.id)
          if (existingVariant) {
            //update variant
            await this.productVariantService_
              .withTransaction(manager)
              .update(existingVariant.id, variantData)
          } else {
            //create variant
            await this.productVariantService_
              .withTransaction(manager)
              .create(existingProduct.id, variantData)
          }

          if (v.media_gallery_entries) {
            productImages.push(...v.media_gallery_entries.map((entry) => entry.url))
          }
        }
        
        //check if any variants should be deleted
        const variantsToDelete = existingProduct.variants.filter(
          (v) => productData.extension_attributes.configurable_product_links.indexOf(v.metadata.magento_id) === -1
        )

        variantsToDelete.forEach(async (variant) => {
          await this.productVariantService_
            .withTransaction(manager)
            .delete(variant.id)
        })
      } else {
        //insert or update a default variant for a simple product

        const variantData = await this.normalizeVariant(productData, []);

        if (existingProduct.variants.length) {
          await this.productVariantService_
            .withTransaction(manager)
            .update(existingProduct.variants[0].id, variantData)
        } else {
          await this.productVariantService_
            .withTransaction(manager)
            .create(existingProduct.id, variantData)
        }
      }

      productImages = [...new Set(productImages)];

      //update product
      delete normalizedProduct.options
      delete normalizedProduct.images

      const update = {}

      for (const key of Object.keys(normalizedProduct)) {
        if (normalizedProduct[key] !== existingProduct[key]) {
          update[key] = normalizedProduct[key]
        }
      }

      normalizedProduct.images = productImages

      if (Object.values(update).length) {
        await this.productService_
          .withTransaction(manager)
          .update(existingProduct.id, update)
      }
    })
  }

  async updateVariant (productData: any, existingVariant: Variant): Promise<void> {
    return this.atomicPhase_(async (manager: EntityManager) => {

      //retrieve store's currencies
      await this.getCurrencies();

      const variantData = await this.normalizeVariant(productData, []);
      delete variantData.options
      delete variantData.magento_id

      const update = {}

      for (const key of Object.keys(variantData)) {
        if (variantData[key] !== existingVariant[key]) {
          update[key] = variantData[key]
        }
      }
      
      if (Object.values(update).length) {
        await this.productVariantService_
            .withTransaction(manager)
            .update(existingVariant.id, variantData)
      }
    })
  }

  async getCurrencies () {
    if (this.currencies.length) {
      return;
    }

    const defaultStore: Store = await this.storeServices_.retrieve({ relations: ['currencies', 'default_currency'] });
    this.currencies = []

    this.currencies.push(...defaultStore.currencies?.map((currency) => currency.code) || [])
    this.currencies.push(defaultStore.default_currency?.code)
  }

  async getDefaultShippingProfile (): Promise<string> {
    if (!this.defaultShippingProfileId.length) {
      this.defaultShippingProfileId = await this.shippingProfileService_.retrieveDefault();
    }

    return this.defaultShippingProfileId;
  }

  async setCategory (categories: Record<string, any>[], product: Record<string, any>, manager: EntityManager) {
    //Magento supports multiple categories for a product
    //since Medusa supports only one collection for a product, we'll
    //use the category with the highest position

    categories.sort((a, b) => {
      if (a.position > b.position) {
        return 1;
      }

      return a.position < b.position ? -1 : 0;
    })

    //retrieve Medusa collection using magento ID
    const [_, count] = await this.productCollectionService_
      .withTransaction(manager)
      .listAndCount()
      
    const existingCollections = await this.productCollectionService_
    .withTransaction(manager)
    .list({}, {
      skip: 0,
      take: count
    });

    if (existingCollections.length) {
      product.collection_id = existingCollections.find((collection) => {
        for (let category of categories) {
          if (collection.metadata.magento_id == category.category_id) {
            return true;
          }
        }

        return false;
      })?.id
    }

    return product;
  }

  normalizeProduct(product: Record<string, any>): any {
    return {
      title: product.name,
      handle: product.custom_attributes?.find((attribute) => attribute.attribute_code === 'url_key')?.value,
      description: this.removeHtmlTags(product.custom_attributes?.find((attribute) => attribute.attribute_code === 'description')?.value || ''),
      type: {
        value: product.type_id
      },
      external_id: product.id,
      status: product.status == 1 ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
      images: product.media_gallery_entries?.map((img) => img.url) || [],
      thumbnail: product.media_gallery_entries?.find((img) => img.types.includes('thumbnail'))?.url,
      options: [],
      collection_id: null
    };
  }

  normalizeVariant (variant: Record<string, any>, options?: Record<string, any>[]): Record<string, any> {
    return {
      title: variant.name,
      prices: this.currencies.map((currency) => ({
        amount: this.parsePrice(variant.price),
        currency_code: currency
      })),
      sku: variant.sku,
      inventory_quantity: variant.stockData.qty,
      allow_backorder: variant.stockData.backorders > 0,
      manage_inventory: variant.stockData.manage_stock,
      weight: variant.weight || 0,
      options: options?.map((option) => {
        const variantOption = variant.custom_attributes?.find((attribute) => attribute.attribute_code.toLowerCase() === option.title.toLowerCase())
        if (variantOption) {
          return {
            option_id: option.id,
            value: option.values.find((value) => value.metadata?.magento_value === variantOption.value)?.value
          }
        }
      }),
      metadata: {
        magento_id: variant.id
      }
    }
  }

  normalizeOption (option: Record<string, any>): any {
    return {
      title: option.label,
      values: option.values.map((value) => ({
        value: value.label,
        metadata: {
          magento_value: value.value,
        }
      })),
      metadata: {
        magento_id: option.id
      }
    }
  }

  parsePrice(price: any): number {
    return parseInt((parseFloat(Number(price).toFixed(2)) * 100).toString());
  }

  removeHtmlTags(str: string): string {
    if ((str===null) || (str==='')) {
      return '';
    }
    
    str = str.toString();
          
    // Regular expression to identify HTML tags in 
    // the input string. Replacing the identified 
    // HTML tag with a null string.
    return str.replace( /(<([^>]+)>)/ig, '');
  }
}

export default MagentoProductService