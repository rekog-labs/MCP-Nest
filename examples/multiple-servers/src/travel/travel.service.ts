import { Injectable } from '@nestjs/common';

@Injectable()
export class TravelService {
  recommend(interest: string): string {
    return interest.toLowerCase().includes('food') ? 'tokyo' : 'london';
  }
}
