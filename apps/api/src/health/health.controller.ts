import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, MongooseHealthIndicator } from '@nestjs/terminus';
import { Public } from '../auth/public.decorator.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongo: MongooseHealthIndicator,
  ) {}

  /** The process is up and serving requests. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** The instance can do useful work: the database answers. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.mongo.pingCheck('mongo', { timeout: 1500 })]);
  }
}
