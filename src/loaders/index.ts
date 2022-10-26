import { BatchJobService } from '@medusajs/medusa'

export default async (container, options) => {
  try {
    const batchJobService: BatchJobService = container.resolve("batchJobService")
    console.log("Creating batch job to import magento products...")
    await batchJobService.create({
      type: 'import-magento',
      context: {
        options
      },
      dry_run: false
    })
  } catch (err) {
    console.log(err)
  }
}
