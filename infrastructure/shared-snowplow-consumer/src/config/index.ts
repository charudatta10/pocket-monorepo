const name = 'SharedSnowplowConsumer';
const domainPrefix = 'shared-snowplow-consumer';
const isDev = process.env.NODE_ENV === 'development';
const environment = isDev ? 'Dev' : 'Prod';
const domain = isDev
  ? `${domainPrefix}.getpocket.dev`
  : `${domainPrefix}.readitlater.com`;
const releaseSha = process.env.CIRCLE_SHA1;
const s3LogsBucket = isDev ? 'pocket-data-items-dev' : 'pocket-data-items';

const snowplowEndpoint = isDev
  ? 'com-getpocket-prod1.mini.snplow.net'
  : 'com-getpocket-prod1.collector.snplow.net';

export const config = {
  name,
  isDev,
  domainPrefix,
  prefix: `${name}-${environment}`,
  circleCIPrefix: `/${name}/CircleCI/${environment}`,
  shortName: 'SSPC', //change to your service name, limit to 6 characters, match shared-infrastructure short name
  releaseSha,
  environment,
  domain,
  s3LogsBucket,
  tracing: {
    host: 'localhost',
  },
  healthCheck: {
    command: [
      'CMD-SHELL',
      'curl -f http://localhost:4001/.well-known/apollo/server-health || exit 1',
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
    costCenter: 'Shared',
    app_code: 'pocket-content-shared',
    component_code: `pocket-content-shared-${name.toLowerCase()}`,
    env_code: isDev ? 'dev' : 'prod',
  },
  eventBridge: {
    prefix: 'PocketEventBridge',
    userTopic: 'UserEvents',
    prospectEventTopic: 'ProspectEventTopic',
    shareableListEventTopic: 'ShareableListEvents',
    shareableListItemEventTopic: 'ShareableListItemEvents',
    collectionEventTopic: 'CollectionEvents',
    sharesApiEventTopic: 'ShareEvents',
    searchApiEventTopic: 'SearchEvents',
  },
  envVars: {
    snowplowEndpoint: snowplowEndpoint,
    ecsEndpoint: `https://${domain}`,
  },
};
