import axios, { AxiosInstance, AxiosResponse } from 'axios';

import { EntityManager } from 'typeorm';
import { Logger } from '@medusajs/medusa/dist/types/global';
import { MedusaError } from 'medusa-core-utils';
import { PluginOptions } from './magento';
import { TransactionBaseService } from '@medusajs/medusa';
import addOAuthInterceptor from 'axios-oauth-1.0a';

export type PluginOptions = {
  magento_url: string;
  consumer_key: string;
  consumer_secret: string;
  access_token: string;
  access_token_secret: string;
  image_prefix?: string;
}

type InjectedDependencies = {
  manager: EntityManager;
  logger: Logger;
}

export type MagentoFilters = {
  field: string;
  value: string;
  condition_type?: string;
}

type SearchCriteria = {
  currentPage: number;
  filterGroups?: MagentoFilters[][];
  storeId?: string;
  currencyCode?: string;
}

export enum MagentoProductTypes {
  CONFIGURABLE = 'configurable',
  SIMPLE = 'simple'
}

class MagentoClientService extends TransactionBaseService {
  protected manager_: EntityManager;
  protected transactionManager_: EntityManager;
  protected logger_: Logger;
  protected apiBaseUrl_: string;
  protected options_: PluginOptions;
  protected client_: AxiosInstance;
  protected defaultStoreId_: string;
  protected defaultCurrencyCode_: string;
  protected defaultImagePrefix_: string;
  
  constructor(container: InjectedDependencies, options: PluginOptions) {
    super(container);
    this.manager_ = container.manager
    this.logger_ = container.logger;
    this.options_ = options;
    this.apiBaseUrl_ = `${options.magento_url}/rest/default/V1`

    this.client_ = axios.create({
      headers: {
        'Accept': 'application/json'
      }
    });

    addOAuthInterceptor(this.client_, {
      algorithm: 'HMAC-SHA256',
      key: options.consumer_key,
      secret: options.consumer_secret,
      token: options.access_token,
      tokenSecret: options.access_token_secret
    });

    this.client_.interceptors.request.use(null, (error) => {
      console.log(error);
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        error.response?.data?.message || error.request?.data?.message || error.message || "An error occurred while sending the request."
      )
    })

    this.client_.interceptors.response.use(null, (error) => {
      console.log(error);
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        error.response?.data?.message || error.request?.data?.message || error.message || "An error occurred while sending the request."
      )
    })

    this.defaultImagePrefix_ = options.image_prefix
  }

  async retrieveProducts(type?: MagentoProductTypes, lastUpdatedTime?: string, filters?: MagentoFilters[][]) : Promise<Record<string, any>[]> {
    const searchCriteria: SearchCriteria = {
      currentPage: 1,
      filterGroups: []
    }

    if (type) {
      searchCriteria.filterGroups.push([
        {
          field: 'type_id',
          value: type,
          condition_type: 'eq'
        }
      ])
    }

    if (lastUpdatedTime) {
      searchCriteria.filterGroups.push([
        {
          field: 'updated_at',
          value: lastUpdatedTime,
          condition_type: 'gt'
        }
      ])
    }

    if (filters) {
      filters.forEach((filterGroup) => {
        const newFilterGroup: MagentoFilters[] = filterGroup.map((filter) => ({
          field: filter.field,
          value: filter.value,
          condition_type: filter.condition_type || 'eq'
        }));
        
        searchCriteria.filterGroups.push(newFilterGroup)
      })
    }

    return this.sendRequest(`/products?${this.formatSearchCriteriaQuery(searchCriteria)}`)
      .then(async ({ data }) => {
        await this.retrieveDefaultConfigs();
        let options;

        if (type === MagentoProductTypes.CONFIGURABLE) {
          options = await this.retrieveOptions();
        }
        
        for (let i = 0; i < data.items.length; i++) {
          data.items[i].media_gallery_entries = data.items[i].media_gallery_entries?.map((entry) => {
            entry.url = `${this.defaultImagePrefix_}${entry.file}`

            return entry
          })

          if (data.items[i].extension_attributes?.configurable_product_options) {
            data.items[i].extension_attributes?.configurable_product_options.forEach((option) => {
              option.values = options.find((o) => o.attribute_id == option.attribute_id)?.options || []
            })
          }

          if (type === MagentoProductTypes.SIMPLE) {
            const response = await this.retrieveInventoryData(data.items[i].sku)
            data.items[i].stockData = response.data;
          }
        }

        return data.items;
      })
  }

  async retrieveProductImages(items: Record<string, any>[]): Promise<Record<string, any>[]> {
    if (!this.defaultStoreId_ || !this.defaultCurrencyCode_) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Default Store ID and Default Currency Code must be set first."
      )
    }

    const { data } = await this.sendRequest(`/products-render-info?${this.formatSearchCriteriaQuery({
      currentPage: 1,
      filterGroups: [
        [
          {
            field: 'entity_id',
            value: items.map((item) => item.id).join(','),
            condition_type: 'in' 
          }
        ]
      ],
      storeId: this.defaultStoreId_,
      currencyCode: this.defaultCurrencyCode_
    })}`)

    return items.map((item) => {
      const itemData = data.items.find((i) => i.id == item.id)
      if (itemData) {
        item.images = itemData.images || []
      }

      return item;
    });
  }

  async retrieveDefaultConfigs() {
    if (this.defaultImagePrefix_) {
      return;
    }

    const { data } = await this.sendRequest(`/store/storeConfigs`)

    const defaultStore = data.length ? data.find((store) => store.code === 'default') : data

    if (!this.defaultImagePrefix_) {
      this.defaultImagePrefix_ = `${defaultStore.base_media_url}catalog/product`
    }
  }

  async retrieveOptionValues (title: string) : Promise<Record<string, any>[]> {
    return this.sendRequest(`/products/attributes/${title}`)
      .then(({ data }) => {
        return data.options.filter((values) => values.value.length > 0);
      })
  }

  async retrieveOptions () : Promise<Record<string, any>[]> {
    const searchCriteria: SearchCriteria = {
      currentPage: 1
    }

    return this.sendRequest(`/products/attributes?${this.formatSearchCriteriaQuery(searchCriteria)}`)
      .then(({ data }) => {
        return data.items;
      })
  }

  async retrieveInventoryData (sku: string) : Promise<AxiosResponse<any, any>> {
    return this.sendRequest(`/stockItems/${sku}`);
  }

  async retrieveSimpleProductsAsVariants (productIds: string[]) : Promise<Record<string, any>[]> {
    return this.retrieveProducts(MagentoProductTypes.SIMPLE, null, [
      [
        {
          field: 'entity_id',
          value: productIds.join(','),
          condition_type: 'in'
        }
      ]
    ])
    .then(async (products) => {
      return await Promise.all(products.map(async (variant) => {
        //get stock item of that variant
        const { data } = await this.retrieveInventoryData(variant.sku)

        return {
          ...variant,
          stockData: data
        }
      }))
    })
  }

  async retrieveCategories (lastUpdatedTime?: string) : Promise<AxiosResponse<any, any>> {
    const searchCriteria: SearchCriteria = {
      currentPage: 1,
      filterGroups: [
        [
          {
            field: 'name',
            value: 'Root Catalog,Default Category',
            condition_type: 'nin'
          }
        ]
      ]
    }

    if (lastUpdatedTime) {
      searchCriteria.filterGroups.push([
        {
          field: 'updated_at',
          value: lastUpdatedTime,
          condition_type: 'gt'
        }
      ])
    }

    return this.sendRequest(`/categories/list?${this.formatSearchCriteriaQuery(searchCriteria)}`)
  }

  async sendRequest (path: string, method: string = 'GET', data?: Record<string, any>) : Promise<AxiosResponse<any, any>> {
    return this.client_.request({
      url: `${this.apiBaseUrl_}${path}`,
      method,
      data
    })
  }

  formatSearchCriteriaQuery (searchCriteria: SearchCriteria): string {
    let query = `searchCriteria[currentPage]=${searchCriteria.currentPage}`;

    if (searchCriteria.filterGroups?.length) {
      searchCriteria.filterGroups.map((filterGroup, index) => {
        filterGroup.map((filter, filterIndex) => {
          query += `&searchCriteria[filterGroups][${index}][filters][${filterIndex}][field]=${filter.field}&searchCriteria[filterGroups][${index}][filters][${filterIndex}][value]=${filter.value}&searchCriteria[filterGroups][${index}][filters][${filterIndex}][condition_type]=${filter.condition_type}`;
        })
      })
    }

    if (searchCriteria.storeId) {
      query += `&storeId=${searchCriteria.storeId}`
    }

    if (searchCriteria.currencyCode) {
      query += `&currencyCode=${searchCriteria.currencyCode}`
    }

    return query;
  }
}

export default MagentoClientService