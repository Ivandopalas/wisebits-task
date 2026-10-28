import type { MeDto, UserDto } from '@chat/shared';
import type { User } from './user.schema.js';

type UserFields = Pick<User, '_id' | 'username' | 'createdAt'>;

export function toUserDto(user: UserFields): UserDto {
  return {
    id: user._id.toString(),
    username: user.username,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toMeDto(user: UserFields & Pick<User, 'email'>): MeDto {
  return { ...toUserDto(user), email: user.email };
}
