<p align="center">
  <a href="https://www.medusa-commerce.com">
    <img alt="Medusa" src="https://i.imgur.com/USubGVY.png" width="100" />
  </a>
</p>
<h1 align="center">
  Magento Source Plugin for Medusa
</h1>
<p align="center">
  A Medusa plugin that imports categories and products from Magento into Medusa.
</p>

## Description

This plugin imports Magento categories and products into Medusa. It creates categories and products that don't exist, and updates those that have been imported previously.

### Limitations

Magento has 6 product types. As some of those types don't exist in Medusa, only the Configurable and Simple products can be imported.

## Prerequisites

### Medusa Setup

You must have a [Medusa server installed](https://docs.medusajs.com/quickstart/quick-start) before installing this plugin.

Furthermore, the Medusa server should have [PostgreSQL](https://docs.medusajs.com/tutorial/set-up-your-development-environment#postgresql) and [Redis](https://docs.medusajs.com/tutorial/set-up-your-development-environment#redis) installed and configured on your Medusa server.

### Magento Setup

On your Magento admin, go to System -> Integrations -> Add New Integrations.

You need to give the integration the access to the following resources:

- Catalog (with its child resources).
- Stores -> Settings (with its child resources).
- Stores -> Attributes (with its child resources).

After creating the integration, activate it from the Integrations listing page. Once you activate it, you'll receive four keys: Consumer Key, Consumer Secret, Access Token, and Access Token Secret. Copy them as you'll need them for the plugin's options.

## Installing Plugin

To install the plugin run the following command on your Medusa server:

```bash
npm install medusa-source-magento
```

## Plugin Configurations

Add the plugin and its options into the `plugins` array in `medusa-config.js`:

```js
const plugins = [
  //...
  {
    resolve: `medusa-source-magento`,
    //if your plugin has configurations
    options: {
      magento_url: '<YOUR_MAGENTO_URL>',
      consumer_key: '<YOUR_CONSUMER_KEY>',
      consumer_secret: '<YOUR_CONSUMER_SECRET>',
      access_token: '<YOUR_ACCESS_TOKEN>',
      access_token_secret: '<YOUR_ACCESS_TOKEN_SECRET>',
      image_prefix: '<MEDIA_URL_PREFIX>' // optional
    },
  },
];
```

### Options

| Name | Description | Required | Default Value|
-------|-------------|----------|--------------|
| `magento_url` | The URL of your Medusa server. It shouldn't end with a backslash. | true | |
| `consumer_key` | The Consumer Key of the integration. | true | |
| `consumer_secret` | The Consumer Secret of the integration. | true | |
| `access_token` | The Access Token of the integration. | true | |
| `access_token_secret` | The Access Token Secret of the integration | true | |
| `image_prefix` | The URL prefix of media files. This is necessary if you don't use Magento's default storage for product images (for example, if you use S3) | false | The URL will be retrieved from Magento. |

## Use the Plugin

### Server Startup

To use the plugin, just start the Medusa server:

```bash
npm start
```

The import process will run in the background of the server. Based on how many products you have, it can take some time the first time running it.

### As a Batch Job

You can trigger the import by creating a new batch job using the Create Batch Job API endpoint. You can pass the following in the payload:

```json
{
    "type": "import-magento",
    "context": { },
    "dry_run": false
}
```

This will trigger the import process.