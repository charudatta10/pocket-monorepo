import { readClient, writeClient } from '../../../../database/client';
import {
  SavedItemDataService,
  UsersMetaService,
} from '../../../../dataService';
import { mysqlTimeString } from '../../../../dataService/utils';
import config from '../../../../config';
import { ContextManager } from '../../../../server/context';
import { getUnixTimestamp } from '../../../../utils';
import { startServer } from '../../../../server/apollo';
import { Application } from 'express';
import { ApolloServer } from '@apollo/server';
import request from 'supertest';
import { TagModel } from '../../../../models';

describe('updateTag Mutation: ', () => {
  const writeDb = writeClient();
  const readDb = readClient();
  const headers = { userid: '1' };
  const date = new Date('2020-10-03 10:20:30'); // Consistent date for seeding
  const date1 = new Date('2020-10-03 10:30:30'); // Consistent date for seeding
  const updateDate = new Date(2021, 1, 1, 0, 0); // mock date for insert
  let app: Application;
  let server: ApolloServer<ContextManager>;
  let url: string;

  beforeAll(async () => {
    // Mock Date.now() to get a consistent date for inserting data
    ({ app, server, url } = await startServer(0));
  });

  afterAll(async () => {
    await writeDb.destroy();
    await readDb.destroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
    await server.stop();
  });

  beforeEach(async () => {
    jest.useFakeTimers({
      now: updateDate,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
      advanceTimers: false,
    });
    jest.clearAllMocks();
    const baseTag = {
      user_id: 1,
      status: 1,
      api_id: 'apiid',
      api_id_updated: 'updated_api_id',
    };
    await writeDb('item_tags').truncate();
    await writeDb('item_tags').insert([
      {
        ...baseTag,
        item_id: 0,
        tag: 'zebra',
        time_added: date,
        time_updated: date,
        api_id: 'second_id',
      },
      {
        ...baseTag,
        item_id: 0,
        tag: 'zebra',
        time_added: date,
        time_updated: date,
        api_id: 'second_id',
      },
      {
        ...baseTag,
        item_id: 1,
        tag: 'zebra',
        time_added: date1,
        time_updated: date1,
      },
      {
        ...baseTag,
        item_id: 1,
        tag: 'zebra',
        time_added: date1,
        time_updated: date1,
      },
      {
        ...baseTag,
        item_id: 1,
        tag: 'existing_tag',
        time_added: date1,
        time_updated: date1,
      },
      {
        ...baseTag,
        item_id: 1,
        tag: 'existing_tag',
        time_added: date1,
        time_updated: date1,
      },
      {
        ...baseTag,
        item_id: 2,
        tag: 'unchanged',
        time_added: date1,
        time_updated: date1,
      },
    ]);
    // Add a tag on every item to test batching
    [0, 1, 2].map(async (itemId) => {
      await writeDb('item_tags').insert({
        ...baseTag,
        item_id: itemId,
        time_added: date,
        time_updated: date,
        tag: 'everything-everywhere',
      });
    });
    await writeDb('list').truncate();
    const inputData = [
      { item_id: 0, status: 1, favorite: 0 },
      { item_id: 1, status: 1, favorite: 0 },
      { item_id: 2, status: 1, favorite: 0 },
    ].map((row) => {
      return {
        ...row,
        user_id: 1,
        resolved_id: row.item_id,
        given_url: `http://${row.item_id}`,
        title: `title ${row.item_id}`,
        time_added: date,
        time_updated: date1,
        time_read: date,
        time_favorited: date,
        api_id: 'apiid',
        api_id_updated: 'apiid',
      };
    });
    await writeDb('list').insert(inputData);
  });

  const updateTagsMutation = `
    mutation updateTag($input: TagUpdateInput!) {
      updateTag(input: $input) {
        name
        savedItems {
          edges {
            cursor
            node {
              id
              url
              _updatedAt
            }
          }
        }
      }
    }
  `;

  const happyPathTestCases = ['changed_name', '🤪😒', '(╯°□°)╯︵ ┻━┻'];

  test.each(happyPathTestCases)(
    'should update an existing tag name',
    async (newTagName) => {
      const variables = {
        input: { name: newTagName, id: 'emVicmE=' },
      };

      const expectedSavedItems = [
        {
          node: {
            id: '0',
            url: 'http://0',
            _updatedAt: getUnixTimestamp(updateDate),
          },
          cursor: 'MF8qXzE2MDE3Mzg0MzA=',
        },
        {
          node: {
            id: '1',
            url: 'http://1',
            _updatedAt: getUnixTimestamp(updateDate),
          },
          cursor: 'MV8qXzE2MDE3Mzg0MzA=',
        },
      ];

      const res = await request(app).post(url).set(headers).send({
        query: updateTagsMutation,
        variables,
      });
      expect(res).not.toBeUndefined();
      expect(res.body.data.updateTag.name).toEqual(newTagName);
      expect(res.body.data.updateTag.savedItems.edges).toContainAllValues(
        expectedSavedItems,
      );
    },
  );

  it('should return error if tagId does not exist', async () => {
    const variables = {
      input: { name: 'changed_name', id: 'id_not_found' },
    };

    const res = await request(app).post(url).set(headers).send({
      query: updateTagsMutation,
      variables,
    });

    expect(res).not.toBeUndefined();
    expect(res.body.data).toBeNull();
    expect(res.body.errors[0].message).toContain(
      `Tag Id ${variables.input.id} does not exist`,
    );
  });
  it('should update tag name with primary key conflict', async () => {
    const variables = {
      input: { name: 'existing_tag', id: 'emVicmE=' },
    };

    const res = await request(app).post(url).set(headers).send({
      query: updateTagsMutation,
      variables,
    });

    const expectedSavedItems = [
      {
        node: {
          id: '0',
          url: 'http://0',
          _updatedAt: getUnixTimestamp(updateDate),
        },
        cursor: 'MF8qXzE2MDE3Mzg0MzA=',
      },
      {
        node: {
          id: '1',
          url: 'http://1',
          _updatedAt: getUnixTimestamp(updateDate),
        },
        cursor: 'MV8qXzE2MDE3Mzg0MzA=',
      },
    ];

    const QueryOldTags = await readDb('item_tags')
      .select()
      .where({ tag: 'zebra' });

    expect(res).not.toBeUndefined();
    expect(res.body.data.updateTag.name).toEqual('existing_tag');
    expect(res.body.data.updateTag.savedItems.edges).toContainAllValues(
      expectedSavedItems,
    );
    expect(QueryOldTags.length).toEqual(0);
  });
  it('should update savedItems in chunks if applied to more than the max transaction size of savedItems', async () => {
    const saveServiceUpdateSpy = jest
      .spyOn(SavedItemDataService.prototype, 'listItemUpdateBuilder')
      .mockClear();
    const id = TagModel.encodeId('everything-everywhere');
    const variables = {
      input: { name: 'all-at-once', id },
    };
    const res = await request(app).post(url).set(headers).send({
      query: updateTagsMutation,
      variables,
    });
    // Expect batch of two calls, and all three are in response
    expect(saveServiceUpdateSpy).toHaveBeenCalledTimes(2);
    expect(res.body.data.updateTag.savedItems.edges.length).toEqual(3);
  });
  it('should log the tag mutation', async () => {
    const variables = {
      input: { name: 'existing_tag', id: 'emVicmE=' },
    };
    await request(app).post(url).set(headers).send({
      query: updateTagsMutation,
      variables,
    });
    const res = await readDb('users_meta')
      .where({ user_id: '1', property: 18 })
      .pluck('value');
    expect(res[0]).toEqual(mysqlTimeString(updateDate, config.database.tz));
  });
  it('rejects empty string tags', async () => {
    const variables = {
      input: { name: '', id: 'emVicmE=' },
    };
    const res = await request(app).post(url).set(headers).send({
      query: updateTagsMutation,
      variables,
    });
    expect(res.body.errors).not.toBeUndefined();
    expect(res.body.errors.length).toEqual(1);
    expect(res.body.errors[0].message).toContain(
      'Tag name must have at least 1 non-whitespace character.',
    );
    expect(res.body.errors[0].extensions.code).toEqual('BAD_USER_INPUT');
  });

  it('should roll back if encounter an error during transaction', async () => {
    const listStateQuery = readDb('list').select();
    const tagStateQuery = readDb('item_tags').select();
    const metaStateQuery = readDb('users_meta').select();

    // Get the current db state
    const listState = await listStateQuery;
    const tagState = await tagStateQuery;
    const metaState = await metaStateQuery;

    const logMutation = jest
      .spyOn(UsersMetaService.prototype, 'logTagMutation')
      .mockImplementation(() => {
        throw new Error('server error');
      });
    const variables = {
      input: { id: 'emVicmE=', name: 'existing_tag' },
    };
    const res = await request(app).post(url).set(headers).send({
      query: updateTagsMutation,
      variables,
    });
    expect(res.body.errors.length).toEqual(1);
    expect(res.body.errors[0].extensions.code).toEqual('INTERNAL_SERVER_ERROR');
    expect(await listStateQuery).toContainAllValues(listState);
    expect(await tagStateQuery).toContainAllValues(tagState);
    expect(await metaStateQuery).toContainAllValues(metaState);
    logMutation.mockRestore();
  });
});
