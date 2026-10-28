import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listUsersQuerySchema, objectIdSchema, type ListUsersQuery } from '@chat/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { toUserDto } from './user.mapper.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @Query({ schema: listUsersQuerySchema }) query: ListUsersQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.list(query, user.id);
  }

  @Get(':id')
  async get(@Param('id', { schema: objectIdSchema }) id: string) {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toUserDto(user);
  }
}
