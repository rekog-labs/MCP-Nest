import { Injectable } from '@nestjs/common';

@Injectable()
export class AnalyticsService {
  count(items: string[]): number {
    return items.length;
  }
}
