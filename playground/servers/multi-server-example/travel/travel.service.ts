import { Injectable } from '@nestjs/common';

/**
 * Travel service - the travel server's own domain logic: map an interest to a
 * recommended destination city. It deliberately does NOT know about weather; the
 * travel server gets weather by reusing the shared `WeatherService`.
 */
@Injectable()
export class TravelService {
  private readonly byInterest: Record<string, string> = {
    food: 'Tokyo',
    history: 'London',
    nightlife: 'New York',
  };

  recommend(interest: string): string {
    return this.byInterest[interest.toLowerCase()] ?? 'Tokyo';
  }

  interests(): string[] {
    return Object.keys(this.byInterest);
  }
}
