import nock from 'nock';

import { processor } from './index.ts';
import { config } from './config.ts';
import { SQSEvent } from 'aws-lambda';

/**
 * Test cleanup: delete all documents in corpus indices
 */
async function deleteDocuments() {
  for await (const index of Object.values(config.indexLangMap)) {
    await fetch(
      `${config.esEndpoint}/${index}/_delete_by_query?wait_for_completion=true`,
      {
        method: 'post',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: { match_all: {} } }),
      },
    );
  }
}

async function seedDocuments(seed: { id: string; index: string }[]) {
  const body =
    seed
      .flatMap((doc) => [
        { index: { _id: doc.id, _index: doc.index } },
        { language: 'en' },
      ])
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n';
  await fetch(`${config.esEndpoint}/_bulk`, {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
}

/**
 * Retrieve a document from elasticsearch by index and document ID
 */
async function getDocById(index: string, id: string) {
  const res = await fetch(`${config.esEndpoint}/${index}/_doc/${id}`, {
    method: 'get',
  });
  return await res.json();
}

const BaseParserResult = (url: string) => ({
  item_id: '12345',
  resolved_id: '12345',
  given_url: url,
  normal_url: url,
  resolved_normal_url: url,
  time_to_read: 10,
  title: 'Brene and Barrett on Living into our Values',
  excerpt: `We're back, and we are starting the year with a deep dive into values. I'm not a fan of resolutions, but I absolutely believe in the power of resetting. I can’t think of a more powerful way to double down on ourselves than getting clear on our values and the behaviors that support them — and the shit that gets in the way.`,
  article:
    `'<div  lang="en">\n<div nodeIndex="668">\n<p nodeIndex="669"><b nodeIndex="805">` +
    `Brown: </b> Hi, everyone, I&rsquo;m Bren&eacute; Brown, and this is Unlocking Us.</p >\n</ div >'`,
  is_article: '1',
  has_video: '0',
  has_image: '1',
  is_index: '0',
  videos: [],
});

describe('bulk indexer', () => {
  afterEach(async () => {
    await deleteDocuments();
    nock.cleanAll();
  });
  beforeAll(async () => {
    nock.cleanAll();
    jest.restoreAllMocks();
    await deleteDocuments();
  });
  it('parses and makes request for example SQS message successfully from root handler, with partial success', async () => {
    const seed = [
      { id: '78d3d5f3-4bad-4214-bb27-5c2ea908422c', index: 'corpus_en_luc' },
      { id: '676defd9-a947-4955-8433-c395750d8551', index: 'corpus_en_luc' },
      { id: '3ab75776-42a1-4a54-a6d2-032fbec195eb', index: 'corpus_en_luc' },
      { id: '599b49e5-c91f-47d8-a6d3-1ce2cb520acc', index: 'corpus_en_luc' },
    ];
    await seedDocuments(seed);
    // Setup (scope makes it easier to do inside function)
    const urls = [
      'https://www.barcablaugranes.com/2022/11/9/23448194/barcelona-underline-title-credentials-with-morale-boosting-win-at-el-sadar',
      'https://www.barcablaugranes.com/2023/3/6/23626947/are-xavis-barcelona-lucky-or-good',
      'https://www.espn.com/espn/feature/story/_/id/30423107/ncaa-women-bracketology-2023-women-college-basketball-projections',
      'https://www.cntraveler.com/story/can-americans-travel-to-cuba',
      'https://www.barcablaugranes.com/2023/3/8/23629747/barcelona-trio-are-playing-for-their-camp-nou-futures-now',
      'https://snackstack.net/2024/05/25/uh-oh-a-story-of-spaghettios-and-forgotten-history/',
      'https://getpocket.com/collections/herrajs-collection-test-labels',
      'https://getpocket.com/collections/testing-snowplow-events-for-collection-creation',
    ];
    const nockEndpoint = (url: string) => {
      const params = new URLSearchParams({
        refresh: '0',
        images: '0',
        videos: '0',
        createIfNone: '1',
        enableItemUrlFallback: '1',
        output: 'regular',
        serviceId: config.privilegedServiceId,
        url,
      });
      const result = BaseParserResult(url);
      nock('https://parser.com')
        .get(`/text?${params.toString()}`)
        .reply(200, result);
    };
    urls.forEach((url) => nockEndpoint(url));

    // Test invocation
    const processorRes = await processor(exampleInvocationPayload);
    const roundtrip = await Promise.all([
      getDocById('corpus_en_luc', '78d3d5f3-4bad-4214-bb27-5c2ea908422c'), // the only collection story in first collection
      getDocById('corpus_en_luc', '676defd9-a947-4955-8433-c395750d8551'), // the third collection story in second collection (spot-check)
      getDocById('corpus_en_luc', '3ab75776-42a1-4a54-a6d2-032fbec195eb'), // the approved item
    ]);
    expect(roundtrip).toEqual([
      expect.objectContaining({
        found: true,
        _source: expect.objectContaining({ pocket_item_id: '12345' }),
      }),
      expect.objectContaining({
        found: true,
        _source: expect.objectContaining({ pocket_item_id: '12345' }),
      }),
      expect.objectContaining({
        found: true,
        _source: expect.objectContaining({ pocket_item_id: '12345' }),
      }),
    ]);
    // Even though one of the collection stories succeeded, we actually expect
    // the batch result to fail the message, since some failed due to not being indexed
    expect(processorRes).toEqual({
      batchItemFailures: [
        { itemIdentifier: 'a89c0ea2-7231-4347-889b-8d456812d4a0' },
      ],
    });
  });
  it('filters out failed parser responses and consolidates message ids', async () => {
    const seed = [
      { id: '78d3d5f3-4bad-4214-bb27-5c2ea908422c', index: 'corpus_en_luc' },
      { id: '3ab75776-42a1-4a54-a6d2-032fbec195eb', index: 'corpus_en_luc' },
      { id: '310b6ea8-9206-3e85-2b18-f3c936737182', index: 'corpus_en_luc' },
      { id: '599b49e5-c91f-47d8-a6d3-1ce2cb520acc', index: 'corpus_en_luc' },
    ];
    await seedDocuments(seed);
    // Setup (scope makes it easier to do inside function)
    const urls = [
      {
        url: 'https://www.barcablaugranes.com/2022/11/9/23448194/barcelona-underline-title-credentials-with-morale-boosting-win-at-el-sadar',
        status: 200,
      },
      {
        url: 'https://www.barcablaugranes.com/2023/3/6/23626947/are-xavis-barcelona-lucky-or-good',
        status: 500,
      },
      {
        url: 'https://www.espn.com/espn/feature/story/_/id/30423107/ncaa-women-bracketology-2023-women-college-basketball-projections',
        status: 500,
      },
      {
        url: 'https://www.cntraveler.com/story/can-americans-travel-to-cuba',
        status: 500,
      },
      {
        url: 'https://www.barcablaugranes.com/2023/3/8/23629747/barcelona-trio-are-playing-for-their-camp-nou-futures-now',
        status: 500,
      },
      {
        url: 'https://getpocket.com/collections/herrajs-collection-test-labels',
        status: 200,
      },
      {
        url: 'https://getpocket.com/collections/testing-snowplow-events-for-collection-creation',
        status: 200,
      },
      {
        url: 'https://snackstack.net/2024/05/25/uh-oh-a-story-of-spaghettios-and-forgotten-history/',
        status: 200,
      },
    ];
    const nockEndpoint = (url: string, status: number) => {
      const params = new URLSearchParams({
        refresh: '0',
        images: '0',
        videos: '0',
        createIfNone: '1',
        enableItemUrlFallback: '1',
        output: 'regular',
        serviceId: config.privilegedServiceId,
        url,
      });
      const result = BaseParserResult(url);
      nock('https://parser.com')
        .get(`/text?${params.toString()}`)
        .reply(status, result);
    };
    urls.forEach(({ url, status }) => nockEndpoint(url, status));

    // Test invocation
    const processorRes = await processor(exampleInvocationPayload);
    const roundtrip = await Promise.all([
      getDocById('corpus_en_luc', '78d3d5f3-4bad-4214-bb27-5c2ea908422c'), // the only collection story in first collection
    ]);
    expect(roundtrip).toEqual([
      expect.objectContaining({
        found: true,
        _source: expect.objectContaining({ pocket_item_id: '12345' }),
      }),
    ]);
    // Even though one of the collection stories succeeded, we actually expect
    // the batch result to fail the message, since some failed due to not being indexed
    expect(processorRes).toEqual({
      batchItemFailures: [
        { itemIdentifier: 'a89c0ea2-7231-4347-889b-8d456812d4a0' },
      ],
    });
  });
});

// Real invocation payload sent to the dev lambda -- this is
// very difficult to track and determine as it flows through
// AWS services like EventBridge, SQS, Lambda, etc.
const exampleInvocationPayload: SQSEvent = {
  Records: [
    {
      attributes: {
        ApproximateFirstReceiveTimestamp: '1716486723605',
        ApproximateReceiveCount: '1',
        SenderId: 'AIDAIT2UOQQY3AUEKVGXU',
        SentTimestamp: '1716486723604',
      },
      awsRegion: 'us-east-1',
      body: '{\n  "Type" : "Notification",\n  "MessageId" : "c55be0ca-2bdf-539a-8e78-be03af5c58bf",\n  "TopicArn" : "arn:aws:sns:us-east-1:410318598490:PocketEventBridge-Dev-CollectionEventTopic",\n  "Message" : "{\\"version\\":\\"0\\",\\"id\\":\\"310b6ea8-9206-3e85-2b18-f3c936737182\\",\\"detail-type\\":\\"collection-updated\\",\\"source\\":\\"collection-events\\",\\"account\\":\\"410318598490\\",\\"time\\":\\"2024-05-23T17:52:03Z\\",\\"region\\":\\"us-east-1\\",\\"resources\\":[],\\"detail\\":{\\"collection\\":{\\"externalId\\":\\"599b49e5-c91f-47d8-a6d3-1ce2cb520acc\\",\\"slug\\":\\"herrajs-collection-test-labels\\",\\"title\\":\\"Herraj\'s Collection Test Labels\\",\\"excerpt\\":\\"Testing labels one more time.\\",\\"intro\\":\\"Test me\\",\\"imageUrl\\":\\"\\",\\"status\\":\\"published\\",\\"language\\":\\"EN\\",\\"authors\\":[{\\"collection_author_id\\":\\"069f1440-7791-4e7c-beb5-0ac824d1740c\\",\\"image_url\\":\\"https://s3.amazonaws.com/pocket-collectionapi-dev-images/ef87c510-bdda-4997-91b9-32362bcad6ad.jpeg\\",\\"slug\\":\\"herraj-test-user\\",\\"bio\\":\\"Just testing stuff today\\",\\"name\\":\\"Test Herraj \\",\\"active\\":false}],\\"stories\\":[{\\"collection_story_id\\":\\"78d3d5f3-4bad-4214-bb27-5c2ea908422c\\",\\"image_url\\":\\"https://s3.amazonaws.com/pocket-collectionapi-dev-images/49807536-d26c-49a8-a563-2ae2d610038b.jpeg\\",\\"is_from_partner\\":false,\\"publisher\\":\\"barcablaugranes.com\\",\\"sort_order\\":1,\\"authors\\":[{\\"name\\":\\"Jason Pettigrove\\",\\"sort_order\\":0}],\\"url\\":\\"https://www.barcablaugranes.com/2022/11/9/23448194/barcelona-underline-title-credentials-with-morale-boosting-win-at-el-sadar\\",\\"title\\":\\"Barcelona underline title credentials with morale-boosting win at El Sadar\\",\\"excerpt\\":\\"With Real Madrid having surprisingly stumbled at Vallecas on Monday night, the stage was set at El Sadar for Barcelona to take the three points which would keep them top of La Liga until the turn of the year.\\"}],\\"labels\\":[{\\"collection_label_id\\":\\"794ad945-e385-4820-b350-799a40ea5868\\",\\"name\\":\\"region-east-africa\\"},{\\"collection_label_id\\":\\"97178724-3700-4688-8f30-020bc94c5081\\",\\"name\\":\\"obsessed\\"}],\\"curationCategory\\":{},\\"partnership\\":{},\\"IABParentCategory\\":{},\\"IABChildCategory\\":{},\\"createdAt\\":1668013295,\\"updatedAt\\":1716486723,\\"publishedAt\\":1668013482},\\"eventType\\":\\"collection-updated\\",\\"object_version\\":\\"new\\"}}",\n  "Timestamp" : "2024-05-23T17:52:03.574Z",\n  "SignatureVersion" : "1",\n  "Signature" : "jLC66kOC/fnLG1tFL6BaoiuGimNSMiAN2U3/lc+wGHLagbL9u9s2F7JpIgusg/gFYF+W7ChZgqtvpO/Lg718sXCPeWI2rEwoInrqy4vASiOy5Cpq9bT3+Rl6/r2obPmQeW+YpHgV1Np5jBbvpTGKgFEh5yJRfrGTXXqoE8/s8pxFAv18hRlViBjhDhf717+JCdZMqax3QWLkbtABP1F91IJs/RlY0XrOnCQQa+eHtPC+UmQVHjJ4lmI8EIGyH/pPuaRMtjJ85YMAs1o3mKF3t6gjzS0W0tFeHvj6TICSiAzlqZ2LEDzz3ox1rLvolDU9/BV0AjqerWwMNTpjnVzRJw==",\n  "SigningCertURL" : "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-60eadc530605d63b8e62a523676ef735.pem",\n  "UnsubscribeURL" : "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:410318598490:PocketEventBridge-Dev-CollectionEventTopic:eaf0de7c-db3b-4285-8d16-69ad56d03446"\n}',
      eventSource: 'aws:sqs',
      eventSourceARN:
        'arn:aws:sqs:us-east-1:410318598490:UserListSearch-Dev-CorpusEvents',
      md5OfBody: 'd54ac57950edefc81f8abc805a64164b',
      messageAttributes: {},
      messageId: '2e725b1c-40fa-4384-bd7a-837a0ad66074',
      receiptHandle:
        'AQEBoeO344RSbnIQ/DC61A4R0zQF6XN3rT5zEBRHMpB9rGngnrkWRqRTq0Zm7RVdOag1uDcePLXi13TdPsKDbRnugiEoAboTnSBDkCVgEtl9zpZktx8Fkl7/RT4biFozaYNdLVBwvT3fY4dYRztlE6yau2tv8P0HVptuB+IyRhxT+pPdJPuJBzs3Y6fgJtOtQkNg+PitUpzXc4m2HT8GAe5FCUFMO5eJtW+J63vBVCL7qYxubo8PNLw/gSCgADruErnbxugtV4zwLgRx6zJSkeRguV0G6aARCqjueld7qFnpheTnQGJ8ITOMxVLRnrjOB525bH/6skSJIeqDjgNypyXbcUslTAN9A4Scv6G8gPGxEeiNl7IYciZxVwP9eTGjxJukSYEtJuNwNLdnU4EVVKAN0OU+a2U6V6iE2g1qz7Q9hhg=',
    },
    {
      attributes: {
        ApproximateFirstReceiveTimestamp: '1716486744502',
        ApproximateReceiveCount: '1',
        SenderId: 'AIDAIT2UOQQY3AUEKVGXU',
        SentTimestamp: '1716486744497',
      },
      awsRegion: 'us-east-1',
      body: '{\n  "Type" : "Notification",\n  "MessageId" : "5d07515a-76ea-51b4-9ec2-0f93f272cfde",\n  "TopicArn" : "arn:aws:sns:us-east-1:410318598490:PocketEventBridge-Dev-CollectionEventTopic",\n  "Message" : "{\\"version\\":\\"0\\",\\"id\\":\\"c746591a-c58d-a57c-859b-9148a29f950e\\",\\"detail-type\\":\\"collection-updated\\",\\"source\\":\\"collection-events\\",\\"account\\":\\"410318598490\\",\\"time\\":\\"2024-05-23T17:52:24Z\\",\\"region\\":\\"us-east-1\\",\\"resources\\":[],\\"detail\\":{\\"collection\\":{\\"externalId\\":\\"fe67c4a0-ed4d-4489-a79a-9380dd8a2576\\",\\"slug\\":\\"testing-snowplow-events-for-collection-creation\\",\\"title\\":\\"Testing Snowplow Events for Collection Creaton\\",\\"excerpt\\":\\"Testing snowplow events\\",\\"intro\\":\\"Testing snowplow events - BOB\\",\\"imageUrl\\":\\"https://s3.amazonaws.com/pocket-collectionapi-dev-images/78b70fd8-a68b-437f-b56b-f4d98edbd7cd.jpeg\\",\\"status\\":\\"published\\",\\"language\\":\\"EN\\",\\"authors\\":[{\\"collection_author_id\\":\\"3631fa19-9e3e-4cd9-b208-6de6fe579031\\",\\"image_url\\":\\"\\",\\"slug\\":\\"harry-potter\\",\\"bio\\":\\"Something happened to this boy. Books were written. \\",\\"name\\":\\"Harry Potter\\",\\"active\\":true}],\\"stories\\":[{\\"collection_story_id\\":\\"33b3cccf-e01d-43b0-8789-c4c0008a5c07\\",\\"image_url\\":\\"https://s3.amazonaws.com/pocket-collectionapi-dev-images/70654728-e85e-449e-9bb1-566a16f070af.jpeg\\",\\"is_from_partner\\":false,\\"publisher\\":\\"barcablaugranes.com\\",\\"sort_order\\":1,\\"authors\\":[{\\"name\\":\\"Nick Batlle\\",\\"sort_order\\":0}],\\"url\\":\\"https://www.barcablaugranes.com/2023/3/6/23626947/are-xavis-barcelona-lucky-or-good\\",\\"title\\":\\"Are Xavi’s Barcelona lucky or good?\\",\\"excerpt\\":\\"Another matchday, another result for Barcelona as they march towards a La Liga title. Another matchday, and more dropped points for Real Madrid after drawing 0-0 with Real Betis.\\"},{\\"collection_story_id\\":\\"15a0621e-32d8-4997-8b1f-fad0ef082b26\\",\\"image_url\\":\\"https://s3.amazonaws.com/pocket-collectionapi-dev-images/5c3281a4-2ffe-4e35-8c99-66aa0bd285c3.jpeg\\",\\"is_from_partner\\":false,\\"publisher\\":\\"ESPN\\",\\"sort_order\\":2,\\"authors\\":[{\\"name\\":\\"ESPN Illustration\\",\\"sort_order\\":0}],\\"url\\":\\"https://www.espn.com/espn/feature/story/_/id/30423107/ncaa-women-bracketology-2023-women-college-basketball-projections\\",\\"title\\":\\"Women\'s Bracketology: 2023 NCAA tournament\\",\\"excerpt\\":\\"One year after the field expanded from 64 to 68 teams, the women\'s NCAA tournament will undergo another major change in 2023. Instead of the customary four regional sites, next year\'s field will have two: Greenville and Seattle.\\"},{\\"collection_story_id\\":\\"676defd9-a947-4955-8433-c395750d8551\\",\\"image_url\\":\\"https://s3.us-east-1.amazonaws.com/pocket-collectionapi-dev-images/9ed2befc-bbfd-44df-acf1-3547c8081d55.jpeg\\",\\"is_from_partner\\":false,\\"publisher\\":\\"Condé Nast Traveler\\",\\"sort_order\\":3,\\"authors\\":[{\\"name\\":\\"Tony Perrottet\\",\\"sort_order\\":0}],\\"url\\":\\"https://www.cntraveler.com/story/can-americans-travel-to-cuba\\",\\"title\\":\\"Can Americans Travel to Cuba?\\",\\"excerpt\\":\\"It’s a common misconception that US passport holders cannot travel to Cuba. Here’s how to make your first visit happen.\\"},{\\"collection_story_id\\":\\"53150cec-d60d-483d-8c71-06725bd328da\\",\\"image_url\\":\\"https://s3.amazonaws.com/pocket-collectionapi-dev-images/50c441b5-47d6-4e3e-96c8-94546950195b.jpeg\\",\\"is_from_partner\\":true,\\"publisher\\":\\"barcablaugranes.com\\",\\"sort_order\\":4,\\"authors\\":[{\\"name\\":\\"Jason Pettigrove\\",\\"sort_order\\":0}],\\"url\\":\\"https://www.barcablaugranes.com/2023/3/8/23629747/barcelona-trio-are-playing-for-their-camp-nou-futures-now\\",\\"title\\":\\"Barcelona trio are playing for their Camp Nou futures now\\",\\"excerpt\\":\\"After Joan Laporta’s latest interview, there can be no doubt that three Barcelona players will be playing for their futures at the club over the next few months.\\"}],\\"labels\\":[{\\"collection_label_id\\":\\"c3707040-5eb2-11ed-94ce-0212e7d2aa37\\",\\"name\\":\\"region-east-europe\\"},{\\"collection_label_id\\":\\"794ad945-e385-4820-b350-799a40ea5868\\",\\"name\\":\\"region-east-africa\\"},{\\"collection_label_id\\":\\"97178724-3700-4688-8f30-020bc94c5081\\",\\"name\\":\\"obsessed\\"},{\\"collection_label_id\\":\\"9aca806b-976f-4607-8217-8ab1bbf16094\\",\\"name\\":\\"read-before-you-go\\"},{\\"collection_label_id\\":\\"8fe9864a-ea7b-4d30-a051-ee23d973318b\\",\\"name\\":\\"relationships\\"},{\\"collection_label_id\\":\\"35f00a78-c4f7-46c0-afa4-0feb08c720c0\\",\\"name\\":\\"katerina-label-1\\"}],\\"curationCategory\\":{\\"collection_curation_category_id\\":\\"da4fa2c3-6496-453c-9064-c48b2fb77986\\",\\"name\\":\\"Science\\",\\"slug\\":\\"science\\"},\\"partnership\\":{\\"collection_partnership_id\\":\\"2457ef44-a426-4b01-a01e-67581d269e2b\\",\\"image_url\\":\\"\\",\\"blurb\\":\\"Testing events partnership\\",\\"name\\":\\"Testing events partnersip\\",\\"url\\":\\"\\",\\"type\\":\\"PARTNERED\\"},\\"IABParentCategory\\":{\\"collection_iab_parent_category_id\\":\\"8d4eea39-bd16-460e-a392-db25cc44a450\\",\\"name\\":\\"Business\\",\\"slug\\":\\"Business\\"},\\"IABChildCategory\\":{\\"collection_iab_child_category_id\\":\\"c19de370-8e1d-42cf-bd1c-f93ed7506c78\\",\\"name\\":\\"Biotech/Biomedical\\",\\"slug\\":\\"Biotech/Biomedical\\"},\\"createdAt\\":1678134426,\\"updatedAt\\":1716486744,\\"publishedAt\\":1678134535},\\"eventType\\":\\"collection-updated\\",\\"object_version\\":\\"new\\"}}",\n  "Timestamp" : "2024-05-23T17:52:24.465Z",\n  "SignatureVersion" : "1",\n  "Signature" : "HNen08t8gyOfRb3A5qKxHJQk7BU/UNOsNhcJOTNVnbRB7ZihcN6qTtXua9EfS4bjzb+Le2sONnItgEOpgiBHkAqM3sdG58jClhox3gmMwgrD9FOG3kgm3yVVGkZuTO23l45cLXre7TYixFXDxoPrtQBJphslbDWDcFqf3OS+tmwJKOOCM4NXQWRpHM1gF/6HWaqGaca6siIvgB42GEdpeggz/PGuKkqW6x72f0gwSIjSpuKHKsBUCzJVKNNa1C0RM/PonzzHbjZGePxrdsFow5+W9S+TeKKMv5njt4DLf9r0Zt7IwpgTRekd9ntVsqH2MO/Z/aQHh219XxvhrNnwTg==",\n  "SigningCertURL" : "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-60eadc530605d63b8e62a523676ef735.pem",\n  "UnsubscribeURL" : "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:410318598490:PocketEventBridge-Dev-CollectionEventTopic:eaf0de7c-db3b-4285-8d16-69ad56d03446"\n}',
      eventSource: 'aws:sqs',
      eventSourceARN:
        'arn:aws:sqs:us-east-1:410318598490:UserListSearch-Dev-CorpusEvents',
      md5OfBody: 'd6e99259971d8a7f6055fa612580811b',
      messageAttributes: {},
      messageId: 'a89c0ea2-7231-4347-889b-8d456812d4a0',
      receiptHandle:
        'AQEBH8A43AOSt9LC6PWYqTnu+3pVGx43nmsuVI0oALNieVa5SJ8CKu9dhQZKEpjQ4CxjWy19ic9r0AbpIGuj5JtB3nx5sf8jceCaF3Tjx3Cat22shHHsG251TTP8bSNx37Z2tHLBoWDiRYYgMoLBf7KlGi3DG4NOPN1pM/4fFiIpS+M1Jmnytz83IUd8+fgwEGZGAJ4pHQEjWHIA9sFinhaKoxow2tjWjp6bx6MxO/ZL6HMjUp/uHm6G0wrUMcpONwaP4mo6ZgNKnzkvzr+dyqmdUOwiv1grWWKBL9jtSua02ze/FoibmyMnYFZZJxNNyqrj25NdP0OPPcakwkcznjjd/08Tc4AbvsGHaQZ5foFPUUfITqW9K0fpS6KijEcXd5boXKq1GKWaxJ20j2Of+SmbMtB1+U6eBh8t8nfyz1YS8k4=',
    },
    {
      messageId: '9f9792df-ab70-4884-8b72-cee0b8340afa',
      receiptHandle:
        'AQEBN1gA3AxoGK5y86v2mQGNkUJaBIl6K7KtdyEOnBmKgktdTL0fLppwhXWkgq/jrb5nr/uxvMCCFioPbfv5OaBgcSo/yRgj1PLet17pTKmEkczuIqF4MNH/SsiwmgyuG6lKMla53r8qzOoxmckb/Zie3gQ414Bok0AJc4+ts8MvKvwFmCUZgu9aeIzVzDuL1nOpJMda+Q0RxTEltZCmEJKr8cO8oZsy3po5wg9rFk6ITi0k19B76qlq3UTqXj6jB6BokL8z7Qq0JASfXGAxDGFRHg5riK1U5SG+pgfoFGJMfl/bwq+ZR9PrMTAE3+zmMcIZNVxAWeIljrAbgoUw7P5klYQScEsx9hjLn1TnYmHgYxEKQRSCoQv+K1OtaOBIG1xHQkSSakQ0HjkI/5nsrakIfZMsM0GuYrPKFF8QWCCSiyg=',
      body: '{\n  "Type" : "Notification",\n  "MessageId" : "fe2cd9e6-4978-5680-84e0-8712b3052acf",\n  "TopicArn" : "arn:aws:sns:us-east-1:996905175585:PocketEventBridge-Prod-CorpusEventsTopic",\n  "Message" : "{\\"version\\":\\"0\\",\\"id\\":\\"ad060d80-ac54-cc42-5902-b3e4aef2a6dd\\",\\"detail-type\\":\\"update-approved-item\\",\\"source\\":\\"curation-migration-datasync\\",\\"account\\":\\"996905175585\\",\\"time\\":\\"2024-06-25T17:02:53Z\\",\\"region\\":\\"us-east-1\\",\\"resources\\":[],\\"detail\\":{\\"eventType\\":\\"update-approved-item\\",\\"approvedItemExternalId\\":\\"3ab75776-42a1-4a54-a6d2-032fbec195eb\\",\\"url\\":\\"https://snackstack.net/2024/05/25/uh-oh-a-story-of-spaghettios-and-forgotten-history/\\",\\"title\\":\\"Uh-Oh: A Story of SpaghettiOs and Forgotten History\\",\\"excerpt\\":\\"In which a pasta-filled rabbit hole leads to an unexpected place.\\",\\"language\\":\\"EN\\",\\"publisher\\":\\"Snack Stack\\",\\"imageUrl\\":\\"https://s3.us-east-1.amazonaws.com/pocket-curatedcorpusapi-prod-images/b853f9bf-ea90-4280-b738-4feef27a4630.jpeg\\",\\"topic\\":\\"FOOD\\",\\"isSyndicated\\":false,\\"createdAt\\":\\"Tue, 25 Jun 2024 16:01:19 GMT\\",\\"createdBy\\":\\"ad|Mozilla-LDAP|mjeltsen\\",\\"updatedAt\\":\\"Tue, 25 Jun 2024 17:02:52 GMT\\",\\"authors\\":[{\\"externalId\\":\\"492ca986-b2b9-492c-a63d-0b0a713a5885\\",\\"name\\":\\"Doug Mack\\",\\"approvedItemId\\":175874,\\"sortOrder\\":0}],\\"isCollection\\":false,\\"domainName\\":\\"snackstack.net\\",\\"datePublished\\":\\"Sat, 25 May 2024 00:00:00 GMT\\",\\"isTimeSensitive\\":false,\\"source\\":\\"MANUAL\\"}}",\n  "Timestamp" : "2024-06-25T17:02:53.154Z",\n  "SignatureVersion" : "1",\n  "Signature" : "BTyAyJAO53xzanvuF5MAopx839LZJgVtUBym1fBn6nCjs7IhonSheqt1T3Afq4TWB3y8VV5hBcaTFqQqSlLCWjPzM8xbfBYL1gP6Ddasxnv2VR77qdhY8c8HmsYEuXO4WvJxqe8YOWVQHVgpegjuyTScaaCWxVztoDYC7O55KUG7hc/oJJw+RoxYNshtyTfEYVHQuV23zbWaNvp4GsbjEjOGcBb7BLTA10H2HPW9SxrU4IhMitgvuJm83Q57z0/6glheWL/aqYyjokaEgyAMTmypJNRflxv6OlVg1TTdcz31gozbIyg8P+q+LgNmUrxq+7NdgB0bp+fA9OFUSkPktQ==",\n  "SigningCertURL" : "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-60eadc530605d63b8e62a523676ef735.pem",\n  "UnsubscribeURL" : "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:996905175585:PocketEventBridge-Prod-CorpusEventsTopic:95ac785f-1b3b-48e1-bf91-4f8583bd6ebd"\n}',
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1719600803083',
        SenderId: 'AROAV7CHE6FNH4IKR3U2R:kschelonka@mozilla.com',
        ApproximateFirstReceiveTimestamp: '1719600803092',
      },
      messageAttributes: {},
      md5OfBody: '09fb67b7b9f0899db20fbec34d77092e',
      eventSource: 'aws:sqs',
      eventSourceARN:
        'arn:aws:sqs:us-east-1:410318598490:UserListSearch-Dev-CorpusEvents',
      awsRegion: 'us-east-1',
    },
  ],
};
