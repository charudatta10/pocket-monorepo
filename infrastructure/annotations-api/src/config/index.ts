const name = 'AnnotationsAPI';
const domainPrefix = 'annotations-api';
const isDev = process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';
const environment = isDev ? 'Dev' : 'Prod';
const domain = isDev
  ? `${domainPrefix}.getpocket.dev`
  : `${domainPrefix}.readitlater.com`;
const graphqlVariant = isDev ? 'development' : 'current';
const cacheNodes = isDev ? 2 : 2;
const cacheSize = isDev ? 'cache.t3.micro' : 'cache.t3.micro';
const appPort = 4008;
const s3LogsBucket = isDev ? 'pocket-data-items-dev' : 'pocket-data-items';
const releaseSha = process.env.CIRCLE_SHA1;

export const config = {
  name,
  isDev,
  isProd,
  prefix: `${name}-${environment}`,
  circleCIPrefix: `/${name}/CircleCI/${environment}`,
  shortName: 'ANNOT',
  environment,
  domain,
  port: appPort,
  graphqlVariant,
  cacheNodes,
  s3LogsBucket,
  reservedConcurrencyLimit: 1,
  cacheSize,
  releaseSha,
  healthCheck: {
    command: [
      'CMD-SHELL',
      `curl -f http://localhost:${appPort}/.well-known/apollo/server-health || exit 1`,
    ],
    interval: 15,
    retries: 3,
    timeout: 5,
    startPeriod: 0,
  },
  tags: {
    service: name,
    environment,
    owner: 'Pocket',
    costCenter: 'Pocket',
    app_code: 'pocket',
    component_code: `pocket-${name.toLowerCase()}`,
    env_code: isDev ? 'dev' : 'prod',
  },
  envVars: {
    databasePort: '3306',
    databaseTz: 'US/Central',
    sqsBatchDeleteQueueName: `${name}-${environment}-Batch-Delete-Consumer-Queue`,
  },
  dynamodb: {
    notesTable: {
      key: 'highlightId',
      // DynamoDB doesn't require a schema, but we want to create an
      // environment variable so we are not working with string field names
      note: 'note',
      userId: 'userId',
    },
  },
  lambda: {
    snsTopicName: {
      userEvents: `PocketEventBridge-${environment}-UserEvents`,
    },
  },
  tracing: {
    url: isDev
      ? 'https://otel-collector.getpocket.dev:443'
      : 'https://otel-collector.readitlater.com:443',
  },
};
