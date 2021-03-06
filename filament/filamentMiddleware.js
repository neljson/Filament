const axios = require('axios');

import { GRAPHQL_ROUTE } from './constants';
import { mergeTwoArraysById, transformQuery } from './utils';
import parseServerFilamentQuery from './parseServerFilamentQuery';

const wrapper = (client) => async (req, res, next) => {
  const clientIP =
    req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const { query, keyInCache } = req.body;
  console.log('KEY IN CACHE', keyInCache);
  client.get(clientIP, async (err, redisCacheAtIP) => {
    // clientIP not found in cache
    console.log('redisCacheAtIP: ', redisCacheAtIP);
    if (!redisCacheAtIP) {
      try {
        const resFromGraphQL = await axios.post(GRAPHQL_ROUTE, { query });

        client.set(
          clientIP,
          JSON.stringify({
            [keyInCache]: resFromGraphQL.data.data[keyInCache],
          }),
          (err, redisCacheAtIPAfterWrite) => {
            console.log('redisCacheAtIP after write', redisCacheAtIPAfterWrite);
          }
        );

        const { data } = resFromGraphQL.data;

        return res.status(200).json({ data });
      } catch (err) {
        console.log('error', err);
      }
      return;
    }

    // clientIP found in cache
    const redisCacheParsed = JSON.parse(redisCacheAtIP);
    const transformedQuery = transformQuery(query);
    const [parsedQuery, dataInRedisCache, isMatched] = parseServerFilamentQuery(
      transformedQuery,
      redisCacheParsed
    );

    if (isMatched) return res.status(200).json({ data: dataInRedisCache });

    // isMatched === false
    try {
      const response = await axios.post(GRAPHQL_ROUTE, { query: parsedQuery });
      // console.log('response', response);
      const resTodos = mergeTwoArraysById(
        dataInRedisCache[keyInCache],
        response.data.data[keyInCache]
      );
      // set the new data in Redis
      const cacheTodos = mergeTwoArraysById(
        JSON.parse(redisCacheAtIP)[keyInCache],
        response.data.data[keyInCache]
      );

      client.set(
        clientIP,
        JSON.stringify({
          [keyInCache]: cacheTodos,
        })
      );

      const dataSendToClient = {
        [keyInCache]: resTodos,
      };

      return res.status(200).json({ data: dataSendToClient });
    } catch (err) {
      console.log('has there been an error????,', err);
    }
  });
};

module.exports = wrapper;
