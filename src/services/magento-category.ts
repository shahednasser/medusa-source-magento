import MagentoClientService, { PluginOptions } from './magento-client';
import { ProductCollection, ProductCollectionService, TransactionBaseService } from '@medusajs/medusa';

import { EntityManager } from 'typeorm';

type InjectedDependencies = {
  magentoClientService: MagentoClientService;
  productCollectionService: ProductCollectionService;
  manager: EntityManager;
}

class MagentoCategoryService extends TransactionBaseService {
  protected manager_: EntityManager;
  protected transactionManager_: EntityManager;
  protected magentoClientService_: MagentoClientService;
  protected productCollectionService_: ProductCollectionService;

  constructor(container: InjectedDependencies, options: PluginOptions) {
    super(container);

    this.manager_ = container.manager;
    this.magentoClientService_ = container.magentoClientService;
    this.productCollectionService_ = container.productCollectionService;
  }

  async create (category: any): Promise<void> {
    return this.atomicPhase_(async (manager) => {
      //check if a collection exists for the category
      const existingCollection = await this.productCollectionService_
        .withTransaction(manager)
        .retrieveByHandle(this.getHandle(category))
        .catch(() => undefined);

      if (existingCollection) {
        return this.update(category, existingCollection)
      }

      //create collection
      const collectionData = this.normalizeCollection(category);

      await this.productCollectionService_
        .withTransaction(manager)
        .create(collectionData)
    })
  }

  async update (category: any, existingCollection: ProductCollection): Promise<void> {
    return this.atomicPhase_(async (manager) => {
      const collectionData = this.normalizeCollection(category);

      const update = {}

      for (const key of Object.keys(collectionData)) {
        if (collectionData[key] !== existingCollection[key]) {
          update[key] = collectionData[key]
        }
      }

      if (Object.values(update).length) {
        await this.productCollectionService_
            .withTransaction(manager)
            .update(existingCollection.id, update)
      }
    })
  }

  normalizeCollection (category: any): any {
    return {
      title: category.name,
      handle: category.custom_attributes.find((attribute) => attribute.attribute_code === 'url_key')?.value,
      metadata: {
        magento_id: category.id
      }
    }
  }

  getHandle(category: any): string {
    return category.custom_attributes.find((attribute) => attribute.attribute_code === 'url_key')?.value || ''
  }
}

export default MagentoCategoryService;