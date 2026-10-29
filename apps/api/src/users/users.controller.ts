import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  apiErrorSchema,
  listUsersQuerySchema,
  objectIdSchema,
  pageSchema,
  userDtoSchema,
  type ListUsersQuery,
} from '@chat/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { toUserDto } from './user.mapper.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiDefaultResponse({ description: 'Error', standardSchema: apiErrorSchema })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiOkResponse({ standardSchema: pageSchema(userDtoSchema) })
  @Get()
  list(
    @Query({ schema: listUsersQuerySchema }) query: ListUsersQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.list(query, user.id);
  }

  @ApiOkResponse({ standardSchema: userDtoSchema })
  @Get(':id')
  async get(@Param('id', { schema: objectIdSchema }) id: string) {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toUserDto(user);
  }
}
