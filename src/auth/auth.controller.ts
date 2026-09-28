import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { LoginDto } from './dto/login.dto';
import { CurrentUser } from './decorators';
import { Public } from './public.decorator';
import type { AuthenticatedUser } from './jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('session')
  @ApiOperation({ summary: 'Exchange SSO access token for a session cookie' })
  @ApiResponse({ status: 200, description: 'Session created, cookie set' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({ status: 404, description: 'User not found or inactive' })
  async createSession(
    @Body() dto: CreateSessionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.verifyAccessToken(dto.access_token);

    const ssoUserId = Number(payload.sub);
    if (!Number.isInteger(ssoUserId)) {
      throw new UnauthorizedException('Invalid token subject');
    }

    const resolved = await this.authService.resolveOrProvisionUser(
      ssoUserId,
      dto.access_token,
    );
    if (!resolved) {
      throw new NotFoundException('User not found or inactive');
    }

    const rawTtlMs = payload.exp
      ? (payload.exp - Math.floor(Date.now() / 1000)) * 1000
      : 60 * 60 * 1000;

    if (rawTtlMs <= 0) {
      throw new UnauthorizedException('Token has expired');
    }

    const maxAge = rawTtlMs;

    res.cookie('uw_access_token', dto.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge,
    });

    return {
      userId: resolved.userId,
      sub: payload.sub,
      email: resolved.email,
      firstName: resolved.firstName,
      lastName: resolved.lastName,
      roles: resolved.roles,
      permissions: resolved.permissions,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Log in with email/password (tenant-invited staff — STORY-005) and receive a session cookie',
  })
  @ApiResponse({ status: 200, description: 'Session created, cookie set' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password);
    if (!result) {
      throw new UnauthorizedException('Invalid email or password');
    }

    res.cookie('uw_access_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: result.expiresInSeconds * 1000,
    });

    return {
      userId: result.user.userId,
      tenantId: result.user.tenantId,
      tenantName: result.user.tenantName,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      roles: result.user.roles,
      permissions: result.user.permissions,
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear the session cookie' })
  @ApiResponse({ status: 204, description: 'Logged out successfully' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.cookie('uw_access_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
  }

  @Get('me')
  @ApiCookieAuth('uw_access_token')
  @ApiOperation({ summary: 'Get the currently authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Authenticated user profile' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return {
      userId: user.userId,
      sub: user.sub,
      tenantId: user.tenantId,
      tenantName: user.tenantName,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      permissions: user.permissions,
    };
  }
}
