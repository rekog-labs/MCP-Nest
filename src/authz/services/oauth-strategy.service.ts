import { Injectable, OnModuleInit, Inject, Optional } from '@nestjs/common';
import passport from 'passport';
import { OAuthModuleOptions } from '../providers/oauth-provider.interface';

export const STRATEGY_NAME = 'oauth-provider';

@Injectable()
export class OAuthStrategyService implements OnModuleInit {
  private strategyName: string;

  constructor(
    @Inject('OAUTH_MODULE_OPTIONS') private options: OAuthModuleOptions,
    @Optional() @Inject('OAUTH_MODULE_ID') private authModuleId?: string,
  ) {
    // Use instance-specific strategy name if authModuleId is provided
    this.strategyName = authModuleId
      ? `${STRATEGY_NAME}-${authModuleId}`
      : STRATEGY_NAME;
  }

  onModuleInit() {
    this.registerStrategy();
  }

  private registerStrategy() {
    const provider = this.options.provider;

    // Use client credentials from resolved options
    const clientId = this.options.clientId;
    const clientSecret = this.options.clientSecret;

    // Use resolved serverUrl (no fallbacks needed)
    const serverUrl = this.options.serverUrl;

    const strategyOptions = provider.strategyOptions({
      serverUrl,
      clientId,
      clientSecret,
      callbackPath: this.options.endpoints.callback,
    });

    const strategy = new provider.strategy(
      strategyOptions,
      (accessToken: string, refreshToken: string, profile: any, done: any) => {
        try {
          const mappedProfile = provider.profileMapper(profile);
          return done(null, {
            profile: mappedProfile,
            accessToken,
            provider: provider.name,
          });
        } catch (error) {
          return done(error, null);
        }
      },
    );

    passport.use(this.strategyName, strategy);
  }

  getStrategyName(): string {
    return this.strategyName;
  }
}
