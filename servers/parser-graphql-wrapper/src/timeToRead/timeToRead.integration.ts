import { ApolloServer } from '@apollo/server';
import { IContext } from '../context';
import { startServer } from '../server';
import nock from 'nock';
import { print } from 'graphql/index';
import { gql } from 'graphql-tag';
import request from 'supertest';
import { Application } from 'express';

describe('timeToRead', () => {
  const testUrl = 'https://someurl.com';

  let app: Application;
  let server: ApolloServer<IContext>;
  let graphQLUrl: string;

  let parserItem = {
    given_url: testUrl,
    normal_url: testUrl,
    item_id: '1',
    resolved_id: '1',
    domain_metadata: {
      name: 'domain',
      logo: 'logo',
    },
    authors: [],
    images: [],
    videos: [],
    time_to_read: 5,
  };

  beforeAll(async () => {
    // port 0 tells express to dynamically assign an available port
    ({ app, server, url: graphQLUrl } = await startServer(0));
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should return timeToRead for a CorpusItem when parser item has time_to_read property', async () => {
    // mock the Parser call to return a parser item with `time_to_read` as 5
    nock(`http://example-parser.com`)
      .get(`/?url=${encodeURIComponent(testUrl)}&getItem=1&output=regular`)
      .reply(200, {
        item: parserItem,
      });

    const corpus_item_query_ = gql`
      query CorpusItem {
        _entities(
          representations: {
            url: "https://someurl.com"
            __typename: "CorpusItem"
          }
        ) {
          ... on CorpusItem {
            url
            timeToRead
          }
        }
      }
    `;

    const res = await request(app)
      .post(graphQLUrl)
      .send({ query: print(corpus_item_query_) });
    expect(res.body).not.toBeNull();
    expect(res.body.data._entities[0].timeToRead).toBe(5);
  });

  it('should return null timeToRead for a CorpusItem when parser item does not have a time_to_read property', async () => {
    parserItem = { ...parserItem, time_to_read: null };

    // mock the Parser call to return a parser item with `time_to_read` as null
    nock(`http://example-parser.com`)
      .get(`/?url=${encodeURIComponent(testUrl)}&getItem=1&output=regular`)
      .reply(200, {
        item: parserItem,
      });

    const corpus_item_query_ = gql`
      query CorpusItem {
        _entities(
          representations: {
            url: "https://someurl.com"
            __typename: "CorpusItem"
          }
        ) {
          ... on CorpusItem {
            url
            timeToRead
          }
        }
      }
    `;

    const res = await request(app)
      .post(graphQLUrl)
      .send({ query: print(corpus_item_query_) });
    expect(res.body).not.toBeNull();
    expect(res.body.data._entities[0].timeToRead).toBe(null);
  });
});
