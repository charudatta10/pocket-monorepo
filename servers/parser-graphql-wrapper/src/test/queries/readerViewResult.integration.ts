import { cleanAll } from 'nock';
import { getRedis } from '../../cache';
import { startServer } from '../../apollo/server';
import { ApolloServer } from '@apollo/server';
import request from 'supertest';
import { print } from 'graphql';
import { gql } from 'graphql-tag';
import { IContext } from '../../apollo/context';
import { Application } from 'express';
import { DataSource } from 'typeorm';
import {
  getConnection,
  getSharedUrlsConnection,
} from '../../datasources/mysql';
import { ItemResolver } from '../../entities/ItemResolver';
import * as ogs from 'open-graph-scraper';
import { nockResponseForParser } from '../utils/parserResponse';
jest.mock('open-graph-scraper');

describe('readerSlug', () => {
  let app: Application;
  let server: ApolloServer<IContext>;
  let graphQLUrl: string;
  let connection: DataSource;

  const GET_READER_INTERSTITIAL = gql`
    query readerSlug($slug: ID!) {
      readerSlug(slug: $slug) {
        slug
        fallbackPage {
          ... on ReaderInterstitial {
            itemCard {
              title
              authors {
                name
              }
              datePublished
              excerpt
              domain {
                name
              }
              image {
                url
              }
              url
              item {
                givenUrl
              }
            }
          }
          ... on ItemNotFound {
            message
          }
        }
      }
    }
  `;

  const testUrl = 'https://test.com';

  const item = {
    itemId: 123,
    searchHash: '123455sdf',
    normalUrl: testUrl,
    resolvedId: 123,
    hasOldDupes: false,
  };

  const parserItemId = '123';

  beforeAll(async () => {
    ({ app, server, url: graphQLUrl } = await startServer(0));
    connection = await getConnection();
    //Delete the items
    const entities = connection.entityMetadatas;
    for (const entity of entities) {
      const repository = connection.getRepository(entity.name);
      await repository.query(`DELETE FROM ${entity.tableName}`);
    }
    //Create a seed item
    const insert = connection.manager.create(ItemResolver, item);
    await connection.manager.save([insert]);
  });

  beforeEach(async () => {
    cleanAll();
    jest.clearAllMocks();
    jest.spyOn(ogs, 'default').mockImplementation(() => {
      return Promise.resolve({
        error: true,
        html: undefined,
        response: undefined,
        result: {},
      });
    });

    nockResponseForParser(testUrl, {
      data: {
        item_id: parserItemId,
        given_url: testUrl,
        normal_url: testUrl,
        title: 'test',
        datePublished: null,
        domainMetadata: { name: 'test.com' },
        excerpt: null,
        authors: [],
        images: [],
        topImageUrl: null,
        videos: [],
        resolved_id: '16822',
      },
    });
    // flush the redis cache
    getRedis().clear();
  });

  afterAll(async () => {
    await server.stop();
    await getRedis().disconnect();
    cleanAll();
    await connection.destroy();
    await (await getSharedUrlsConnection()).destroy();
    jest.restoreAllMocks();
  });

  it('should return item card fallback data', async () => {
    const variables = {
      slug: 'fe562f9c5BCfC1eeQ9AffKeCaiD2a190J7eb5D66B8DccAd6E6a1f247B54Egd22_202cb962ac59075b964b07152d234b70',
    };
    const expected = {
      readerSlug: {
        slug: 'fe562f9c5BCfC1eeQ9AffKeCaiD2a190J7eb5D66B8DccAd6E6a1f247B54Egd22_202cb962ac59075b964b07152d234b70',
        fallbackPage: {
          itemCard: {
            image: null,
            authors: null,
            domain: { name: 'test.com' },
            datePublished: null,
            excerpt: null,
            title: 'test',
            url: testUrl,
            item: {
              givenUrl: testUrl,
            },
          },
        },
      },
    };
    const res = await request(app)
      .post(graphQLUrl)
      .send({ query: print(GET_READER_INTERSTITIAL), variables });
    expect(res.body.data).toEqual(expected);
  });
  it('should return ItemNotFound if ID is not in the database', async () => {
    const variables = {
      slug: '1fcq7b8aaCXcD2ebR2Lb8LhIagEaaaadPaOb0Od0RdJ64B54Fc3d1f98H70A78d6_468ebb364f349ce7428161da948a2202',
    };
    const expected = {
      readerSlug: {
        slug: '1fcq7b8aaCXcD2ebR2Lb8LhIagEaaaadPaOb0Od0RdJ64B54Fc3d1f98H70A78d6_468ebb364f349ce7428161da948a2202',
        fallbackPage: {
          message: "We couldn't find that page.",
        },
      },
    };
    const res = await request(app)
      .post(graphQLUrl)
      .send({ query: print(GET_READER_INTERSTITIAL), variables });
    expect(res.body.data).toEqual(expected);
  });

  it('should return ItemNotFound if ID can not be verified', async () => {
    const variables = {
      slug: '1fcq7b8aaCXcD2ebR2Lb8LhIagEaaaadPaOb0Od0RdJ644Fc3d1f98H70A78d6_468ebb364f349ce742811da948a2202',
    };
    const expected = {
      readerSlug: {
        slug: '1fcq7b8aaCXcD2ebR2Lb8LhIagEaaaadPaOb0Od0RdJ644Fc3d1f98H70A78d6_468ebb364f349ce742811da948a2202',
        fallbackPage: {
          message: "We couldn't find that page.",
        },
      },
    };
    const res = await request(app)
      .post(graphQLUrl)
      .send({ query: print(GET_READER_INTERSTITIAL), variables });
    expect(res.body.data).toEqual(expected);
  });
});
