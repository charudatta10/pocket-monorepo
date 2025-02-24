import DataLoader from 'dataloader';
import {
  Note,
  CreateNoteInput,
  EditNoteTitleInput,
  EditNoteContentInput,
  DeleteNoteInput,
  CreateNoteMarkdownInput,
  EditNoteContentMarkdownInput,
  ArchiveNoteInput,
} from '../__generated__/graphql';
import { DB, Note as NoteEntity } from '../__generated__/db';
import { Insertable, NoResultError, Selectable } from 'kysely';
import { orderAndMap } from '../utils/dataloader';
import { IContext } from '../apollo/context';
import { NotesService } from '../datasources/NoteService';
import { docFromMarkdown, ProseMirrorDoc } from './ProseMirrorDoc';
import { DatabaseError } from 'pg';
import {
  NoteFilterInput,
  NoteSortBy,
  NoteSortInput,
  NoteSortOrder,
} from '../__generated__/graphql';
import {
  UserInputError,
  NotFoundError,
  validatePagination,
  PaginationInput,
} from '@pocket-tools/apollo-utils';
import { config } from '../config';
import {
  CursorField,
  CursorFields,
  DecodedCursor,
  executeWithCursorPagination,
  ExtractFieldKey,
  ExtractOutputType,
  PaginationResult,
} from '../utils/Paginator';
import { AllSelection } from 'kysely/dist/cjs/parser/select-parser';

type AllNote = AllSelection<DB, 'Note'>;

export type NoteConnectionModel = PaginationResult<NoteResponse>;
export type NoteResponse = Omit<Note, 'savedItem'> & {
  savedItem: { url: string } | null;
};

/**
 * Model for retrieving and creating Notes
 */
export class NoteModel {
  loader: DataLoader<string, Selectable<NoteEntity> | null>;
  service: NotesService;
  constructor(public readonly context: IContext) {
    this.service = new NotesService(context);
    this.loader = new DataLoader<string, Selectable<NoteEntity> | null>(
      async (keys: readonly string[]) => {
        const notes = await this.service.getMany(keys);
        return orderAndMap(keys, notes, 'noteId');
      },
    );
  }
  /**
   * Convert a Note response from the database into
   * the desired GraphQL object.
   * @param note
   * @returns
   */
  toGraphql(note: Selectable<NoteEntity>): NoteResponse {
    const savedItem = note.sourceUrl != null ? { url: note.sourceUrl } : null;
    return {
      createdAt: note.createdAt,
      docContent:
        note.docContent != null ? JSON.stringify(note.docContent) : null,
      id: note.noteId,
      savedItem,
      title: note.title,
      updatedAt: note.updatedAt,
      source: note.sourceUrl,
      docMarkdown:
        note.docContent != null
          ? new ProseMirrorDoc(note.docContent).markdown
          : null,
      // TODO - Non-default schema
      contentPreview:
        note.docContent != null
          ? new ProseMirrorDoc(note.docContent).preview
          : null,
      archived: note.archived,
      deleted: note.deleted,
    };
  }

  /**
   * Given NoteSortBy field input, get the corresponding DB column
   */
  sortColumn<O extends AllNote>(
    noteField: NoteSortBy,
  ): CursorField<DB, 'Note', O> {
    const mapping: { [f in NoteSortBy]: CursorField<DB, 'Note', O> } = {
      UPDATED_AT: 'updatedAt',
      CREATED_AT: 'createdAt',
    };
    return mapping[noteField];
  }

  /**
   * Get multiple Notes by IDs. Prefer using `load`
   * unless you need to bypass cache behavior.
   */
  async getMany(ids: readonly string[]): Promise<NoteResponse[]> {
    const notes = await this.service.getMany(ids);
    return notes != null && notes.length > 0
      ? notes.map((note) => this.toGraphql(note))
      : [];
  }
  /**
   * Get a single note by its id.
   * Prefer using `load` unless you need to bypass cache
   * behavior. Will return null if ID does not exist
   * or is inaccessible for the user.
   */
  async getOne(id: string): Promise<NoteResponse | null> {
    const note = await this.service.get(id);
    return note != null ? this.toGraphql(note) : null;
  }
  /**
   * Get a single note by its id (using dataloader to batch load).
   * Will return null if ID does not exist or is inaccessible
   * for the user.
   */
  async load(id: string): Promise<NoteResponse | null> {
    const note = await this.loader.load(id);
    return note != null ? this.toGraphql(note) : null;
  }
  /**
   * Create a new Note.
   */
  async create(input: CreateNoteInput) {
    try {
      // TODO
      // At some point do more validation
      // We can move this to a scalar
      const docContent = JSON.parse(input.docContent);
      const entity: Insertable<NoteEntity> = {
        createdAt: input.createdAt ?? undefined,
        docContent,
        noteId: input.id ?? undefined,
        sourceUrl: input.source?.toString() ?? undefined,
        title: input.title ?? undefined,
        userId: this.context.userId,
        updatedAt: input.createdAt ?? undefined,
      };
      const note = await this.service.create(entity);
      return this.toGraphql(note);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new UserInputError(
          `Received malformed JSON for docContent: ${error.message}`,
        );
      } else if (error instanceof DatabaseError) {
        if (error.code === '23505' && error.constraint === 'Note_noteId_key') {
          throw new UserInputError(
            `Received duplicate value for note ID. ` +
              `Ensure you are generating v4 UUIDs and try again.`,
          );
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }
  /**
   * Create a new note, with CommonMark Markdown-formatted content
   * instead of a JSON representation of a Prosemirror document.
   */
  async createFromMarkdown(input: CreateNoteMarkdownInput) {
    const doc = docFromMarkdown(input.docMarkdown);
    const createInput: CreateNoteInput = {
      ...input,
      docContent: JSON.stringify(doc.toJSON()),
    };
    return await this.create(createInput);
  }
  /**
   * Edit a note's title
   */
  async editTitle(input: EditNoteTitleInput) {
    try {
      const result = await this.service.updateTitle(
        input.id,
        input.title,
        input.updatedAt,
      );
      return this.toGraphql(result);
    } catch (error) {
      if (error instanceof NoResultError) {
        throw new NotFoundError(
          `Note with id=${input.id} does not exist or is forbidden`,
        );
      } else {
        throw error;
      }
    }
  }
  /**
   * Edit a note's content
   */
  async editContent(input: EditNoteContentInput) {
    try {
      // TODO
      // At some point do more validation
      // We can move this to a scalar
      const docContent = JSON.parse(input.docContent);
      const result = await this.service.updateDocContent(
        input.noteId,
        docContent,
        input.updatedAt,
      );
      return this.toGraphql(result);
    } catch (error) {
      if (error instanceof NoResultError) {
        throw new NotFoundError(
          `Note with id=${input.noteId} does not exist or is forbidden`,
        );
      } else if (error instanceof SyntaxError) {
        throw new UserInputError(
          `Received malformed JSON for docContent: ${error.message}`,
        );
      } else {
        throw error;
      }
    }
  }
  /**
   * Edit a note's content, replacing it with the
   * the Commonmark markdown document content input.
   */
  async editContentMarkdown(input: EditNoteContentMarkdownInput) {
    const doc = docFromMarkdown(input.docMarkdown);
    const editInput: EditNoteContentInput = {
      ...input,
      docContent: JSON.stringify(doc.toJSON()),
    };
    return await this.editContent(editInput);
  }
  /**
   * Delete a Note
   */
  async deleteNote(input: DeleteNoteInput) {
    try {
      return await this.service.delete(input.id, input.deletedAt);
    } catch (error) {
      if (error instanceof NoResultError) {
        return input.id;
      } else {
        throw error;
      }
    }
  }
  /**
   * Archive a Note
   */
  async archive(input: ArchiveNoteInput) {
    try {
      const result = await this.service.archive(input.id, input.updatedAt);
      return this.toGraphql(result);
    } catch (error) {
      if (error instanceof NoResultError) {
        throw new NotFoundError(
          `Note with id=${input.id} does not exist or is forbidden`,
        );
      } else {
        throw error;
      }
    }
  }
  /**
   * Unarchive a Note
   */
  async unarchive(input: ArchiveNoteInput) {
    try {
      const result = await this.service.unarchive(input.id, input.updatedAt);
      return this.toGraphql(result);
    } catch (error) {
      if (error instanceof NoResultError) {
        throw new NotFoundError(
          `Note with id=${input.id} does not exist or is forbidden`,
        );
      } else {
        throw error;
      }
    }
  }

  /**
   * Paginate over a note connection
   * @param opts pagination options
   * @returns NoteConnectionModel
   */
  async paginate(opts: {
    sort?: NoteSortInput;
    filter?: NoteFilterInput & { sourceUrl?: string | undefined };
    pagination?: PaginationInput;
  }): Promise<NoteConnectionModel> {
    const { sort, filter, pagination } = opts;
    const defaultPagination = { first: config.database.defaultPageSize };
    const pageInput =
      pagination != null
        ? validatePagination(
            pagination,
            config.database.defaultPageSize,
            config.database.maxPageSize,
          )
        : defaultPagination;
    const sortInput: NoteSortInput =
      sort != null
        ? sort
        : { sortBy: NoteSortBy.UpdatedAt, sortOrder: NoteSortOrder.Desc };

    const baseQuery = this.service.filterQuery(filter);

    // The passed sort + 'id' as the tiebreaker
    const cursorFields = [
      this.sortColumn<AllNote>(sortInput.sortBy),
      'id',
    ] as CursorFields<DB, 'Note', ExtractOutputType<typeof baseQuery>>;
    const result = await executeWithCursorPagination<
      DB,
      'Note',
      ExtractOutputType<typeof baseQuery>,
      typeof cursorFields
    >(baseQuery, {
      ...pageInput,
      sortBy: cursorFields,
      order: sortInput.sortOrder === NoteSortOrder.Asc ? 'asc' : 'desc',
      encodeCursor: (row) =>
        NoteModel.encodeCursor<
          ExtractOutputType<typeof baseQuery>,
          typeof cursorFields
        >(row, cursorFields),
      decodeCursor: (cursor) =>
        NoteModel.decodeCursor<
          ExtractOutputType<typeof baseQuery>,
          typeof cursorFields
        >(cursor, cursorFields),
    });
    const edges = result.edges.map((edge) => ({
      cursor: edge.cursor,
      node: this.toGraphql(edge.node),
    }));
    return { ...result, edges };
  }

  /**
   * Decode a cursor string from a NoteConnection
   * @param cursor the cursor string to decode
   * @param fields the fields used to create the cursor
   * @returns a decoded cursor object with key, value pairs
   * corresponding to the field name and value
   */
  public static decodeCursor<O, TCursor extends CursorFields<DB, 'Note', O>>(
    cursor: string,
    fields: TCursor,
  ): DecodedCursor<DB, 'Note', O, TCursor> {
    let parsed;
    try {
      parsed = [
        ...new URLSearchParams(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        ).entries(),
      ];
    } catch {
      throw new UserInputError('Unparsable cursor');
    }
    // Validation
    if (fields.length !== parsed.length) {
      throw new UserInputError('Sort fields did not match cursor');
    }
    fields.forEach((field, index) => {
      if (field !== parsed[index][0]) {
        throw new UserInputError('Sort fields did not match cursor');
      }
    });

    // Deserialize acceptable fields from string representations to
    // Typescript objects
    const deserializer = (
      field: ExtractFieldKey<DB, 'Note', O, TCursor[number]>,
      value: string,
    ) => {
      switch (field) {
        case 'updatedAt':
        case 'createdAt':
          return new Date(value) as O[ExtractFieldKey<
            DB,
            'Note',
            O,
            TCursor[number]
          >];
        default:
          return value as O[ExtractFieldKey<DB, 'Note', O, TCursor[number]>];
      }
    };

    return fields.reduce(
      (decoded, field: CursorField<DB, 'Note', O>, index) => {
        decoded[field as ExtractFieldKey<DB, 'Note', O, typeof field>] =
          deserializer(
            field as ExtractFieldKey<DB, 'Note', O, typeof field>,
            parsed[index][1],
          );
        return decoded;
      },
      {} as DecodedCursor<DB, 'Note', O, TCursor>,
    );
  }

  /**
   * Encode a cursor string from a Note response
   * @param row the data returned from the Note query
   * @param fields the fields used to create the cursor
   * @returns a cursor for the given row
   */
  public static encodeCursor<O, T extends CursorFields<DB, 'Note', O>>(
    row: {
      [Field in ExtractFieldKey<DB, 'Note', O, T[number]>]: O[ExtractFieldKey<
        DB,
        'Note',
        O,
        T[number]
      >];
    },
    fields: T,
  ): string {
    const cursorValues = fields.map((field) => {
      const fieldName = field as ExtractFieldKey<DB, 'Note', O, typeof field>;
      if (row[fieldName] instanceof Date) {
        return `${fieldName}=${row[fieldName].toISOString()}`;
      } else if (
        typeof row[fieldName] === 'boolean' ||
        typeof row[fieldName] === 'bigint' ||
        typeof row[fieldName] === 'number' ||
        typeof row[fieldName] === 'string'
      ) {
        return `${fieldName}=${row[fieldName].toString()}`;
      } else {
        throw Error(`Invalid field used for cursor: ${fieldName}`);
      }
    });
    return Buffer.from(cursorValues.join('&')).toString('base64url');
  }
}
