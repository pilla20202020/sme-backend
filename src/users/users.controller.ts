import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';
import { SafeUser } from './users.interface';
import { Roles } from '../auth/decorators';
import { Permissions } from '../auth/decorators';

@ApiTags('Users')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'users' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin')
  @Permissions('user:create')
  @ApiOperation({ summary: 'Create a new user (admin only)' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Email or SSO ID already exists' })
  create(@Body() createUserDto: CreateUserDto): Promise<SafeUser> {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @Roles('admin')
  @Permissions('user:read')
  @ApiOperation({ summary: 'List all users with pagination (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated list of user records' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.usersService.findAll(query);
  }
}
