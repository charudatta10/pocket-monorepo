import { processMessages } from './userItemsUpdate';
import { MysqlDataSource } from '../datasource/MysqlDataSource';
import { sendMessage, purgeQueue } from '../sqs';
import { config } from '../config';
import { seedDb } from '../test/_support/seeder';
import { getDocument } from '../datasource/elasticsearch/elasticsearchSearch';
import { client } from '../datasource/elasticsearch';

//Set this here so the client instantiates outside of the before block that has a timeout.
const esClient = client;

describe('updateUserSearch', () => {
  beforeAll(async () => {
    await esClient.deleteByQuery({
      index: config.aws.elasticsearch.index,
      type: config.aws.elasticsearch.type,
      body: {
        query: {
          match_all: {},
        },
      },
    });
    // Wait for delete to finish
    await esClient.indices.refresh({ index: config.aws.elasticsearch.index });
  });

  it('processes item index queue', async () => {
    await Promise.all([
      seedDb({
        truncate: true,
        userCount: 2,
        listCount: 10,
        tagCount: 5,
        forcePremium: true,
      }),
      purgeQueue(config.aws.sqs.userItemsUpdateUrl),
      purgeQueue(config.aws.sqs.userListImportUrl),
    ]);

    //Populate the queue with users and item ids to add
    await sendMessage(config.aws.sqs.userItemsUpdateUrl, {
      userItems: [
        {
          userId: 1,
          itemIds: [1, 2, 3, 4, 5],
        },
        {
          userId: 2,
          itemIds: [6, 7, 8, 9, 10],
        },
      ],
    });

    //Let the user item processor process the queue
    await processMessages(new MysqlDataSource());
    //Ensure each document we just passed along was indexed for user 1
    for (let i = 1; i <= 5; i++) {
      const doc = await getDocument(`1-${i}`);
      expect(doc._id).toBe(`1-${i}`);
    }

    //Ensure each document we just passed alone was indexed for user 2
    for (let i = 6; i <= 10; i++) {
      const doc = await getDocument(`2-${i}`);
      expect(doc._id).toBe(`2-${i}`);
    }
  }, 20000);
});
