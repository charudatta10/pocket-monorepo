import { GraphQLScalarType, Kind } from 'graphql';
import { DateTime, Settings } from 'luxon';
import {
  InternalServerError,
  UserInputError,
} from '../errorHandler/errorHandler.ts';

export const isoStringScalar = new GraphQLScalarType({
  name: 'ISOString',
  description: 'ISOString custom scalar type',

  /**
   * Converts server-side TS Date representation to a JSON-compatible, ISO-8601-compliant
   * UTC Datetime String for Apollo Server to include in an operation response.
   *
   * @param value - TS Date Object as generated by Data Store Client & validated by mysqlDateConvert.
   * @returns ISO-8601-compliant, UTC-based Datetime String.
   */
  serialize(value: Date | null): string | null {
    if (value === null) {
      return null;
    }

    if (!(value instanceof Date)) {
      throw new InternalServerError(
        'GraphQL ISOString Scalar serializer expected a `Date` object or null',
      );
    }

    // isNaN here checks for 0000-00-00-styled dates, which are invalid, & other invalid
    if (isNaN(value.valueOf())) {
      throw new InternalServerError(
        'Invalid Data Store Response: invalid Date object',
      );
    }

    // toISOString() is always zero UTC offset per
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
    const resp: string = value.toISOString();
    return resp;
  },

  /**
   * Converts the scalar's JSON value to its back-end representation
   * before it's added to a resolver's args.
   *
   * @param value - ISO-8601-compliant Datetime String.
   * @returns TS Data Object for interacting with Data Store via Client.
   */
  parseValue(value: string | null): Date | null {
    if (value === null || value === '') {
      return null;
    }

    if (!(typeof value === 'string')) {
      throw new UserInputError(
        'Invalid User Input: ISOString Scalar parse expected a value of type string or null',
      );
    }

    // We only want explicitly UTC dates passed in. So we override the default (system) TZ to be US Central
    // to force an error on any dates not explicit set to a timezone (which still works if the system is set to UTC).
    Settings.defaultZone = 'America/Chicago';
    const isoDateTime = DateTime.fromISO(value, { setZone: true });
    if (!(isoDateTime.offset === 0) || !isoDateTime.isValid) {
      throw new UserInputError(
        'Invalid User Input: ISOString Scalar parse expected a UTC-based, ISO-8601-compliant string',
      );
    }

    return isoDateTime.toJSDate();
  },

  /**
   * Converts the value's AST representation to the scalar's back-end representation.
   *
   * @param ast - AST Representation of ISOString.
   * @returns TS Date Object.
   */
  parseLiteral(ast): Date | null {
    if (!(ast.kind === Kind.STRING)) {
      throw new UserInputError(
        'Invalid User Input: ISOString Scalar parse expected a value of type string or null',
      );
    }

    return this.parseValue(ast.value);
  },
  extensions: {
    codegenScalarType: 'Date | string',
    jsonSchema: {
      type: 'string',
      format: 'date-time',
    },
  },
});
