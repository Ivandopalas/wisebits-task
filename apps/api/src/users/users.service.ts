import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ListUsersQuery, Page, UserDto } from '@chat/shared';
import { Model, Types, type QueryFilter } from 'mongoose';
import { escapeRegex } from '../common/escape-regex.js';
import { isDuplicateKeyError } from '../common/errors/to-api-error.js';
import { toUserDto } from './user.mapper.js';
import { User } from './user.schema.js';

export interface NewUser {
  email: string;
  username: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async create(input: NewUser): Promise<User> {
    try {
      const created = await this.users.create({
        ...input,
        usernameLower: input.username.toLowerCase(),
      });
      return created.toObject();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const field = 'email' in (error.keyPattern ?? {}) ? 'email' : 'username';
        throw new ConflictException({
          message:
            field === 'email' ? 'This email is already registered' : 'This username is taken',
          details: [
            { path: field, message: field === 'email' ? 'Already registered' : 'Already taken' },
          ],
        });
      }
      throw error;
    }
  }

  findByEmailWithPassword(email: string) {
    return this.users.findOne({ email }).select('+passwordHash').lean().exec();
  }

  findById(id: string | Types.ObjectId) {
    return this.users.findById(id).lean().exec();
  }

  async exists(id: string | Types.ObjectId): Promise<boolean> {
    return (await this.users.exists({ _id: id })) !== null;
  }

  findByIds(ids: Array<string | Types.ObjectId>) {
    return this.users
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
  }

  /**
   * Alphabetical list with keyset pagination on `usernameLower`; the search is a
   * case-insensitive prefix match that stays on the same index.
   */
  async list(query: ListUsersQuery, viewerId: string): Promise<Page<UserDto>> {
    const filter: QueryFilter<User> = { _id: { $ne: new Types.ObjectId(viewerId) } };
    const usernameLower: Record<string, unknown> = {};
    if (query.q) {
      usernameLower.$regex = `^${escapeRegex(query.q.toLowerCase())}`;
    }
    if (query.cursor) {
      usernameLower.$gt = query.cursor;
    }
    if (Object.keys(usernameLower).length > 0) {
      filter.usernameLower = usernameLower;
    }

    const docs = await this.users
      .find(filter)
      .sort({ usernameLower: 1 })
      .limit(query.limit + 1)
      .lean()
      .exec();

    const hasMore = docs.length > query.limit;
    const items = hasMore ? docs.slice(0, query.limit) : docs;
    return {
      items: items.map(toUserDto),
      nextCursor: hasMore ? items[items.length - 1]!.usernameLower : null,
    };
  }
}
