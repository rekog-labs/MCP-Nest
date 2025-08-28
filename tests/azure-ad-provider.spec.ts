import { AzureADOAuthProvider } from '../src/authz/providers/azure-ad.provider';

describe('Azure AD OAuth Provider', () => {
  describe('Provider Configuration', () => {
    it('should have correct name and display name', () => {
      expect(AzureADOAuthProvider.name).toBe('azure-ad');
      expect(AzureADOAuthProvider.displayName).toBe('Microsoft Azure AD');
    });

    it('should have correct scope configuration', () => {
      expect(AzureADOAuthProvider.scope).toEqual([
        'openid',
        'profile',
        'email',
        'User.Read',
      ]);
    });

    it('should generate correct strategy options', () => {
      const options = AzureADOAuthProvider.strategyOptions({
        serverUrl: 'https://example.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        callbackPath: 'auth/callback',
      });

      expect(options).toEqual({
        clientID: 'test-client-id',
        clientSecret: 'test-client-secret',
        callbackURL: 'https://example.com/auth/callback',
        tenant: 'common',
        resource: 'https://graph.microsoft.com/',
      });
    });

    it('should normalize callback URL correctly', () => {
      const options1 = AzureADOAuthProvider.strategyOptions({
        serverUrl: 'https://example.com/',
        clientId: 'test',
        clientSecret: 'test',
        callbackPath: '/auth/callback',
      });

      const options2 = AzureADOAuthProvider.strategyOptions({
        serverUrl: 'https://example.com',
        clientId: 'test',
        clientSecret: 'test',
        callbackPath: 'auth/callback',
      });

      expect(options1.callbackURL).toBe('https://example.com/auth/callback');
      expect(options2.callbackURL).toBe('https://example.com/auth/callback');
    });
  });

  describe('Profile Mapping', () => {
    it('should correctly map Azure AD profile with _json', () => {
      const mockProfile = {
        id: 'azure-user-123',
        _json: {
          id: 'azure-user-123',
          userPrincipalName: 'john.doe@company.com',
          displayName: 'John Doe',
          mail: 'john.doe@company.com',
          photo: 'https://graph.microsoft.com/photo.jpg',
        },
      };

      const mappedProfile = AzureADOAuthProvider.profileMapper(mockProfile);

      expect(mappedProfile).toEqual({
        id: 'azure-user-123',
        username: 'john.doe@company.com',
        email: 'john.doe@company.com',
        displayName: 'John Doe',
        avatarUrl: 'https://graph.microsoft.com/photo.jpg',
        raw: mockProfile,
      });
    });

    it('should correctly map Azure AD profile without _json', () => {
      const mockProfile = {
        id: 'azure-user-456',
        userPrincipalName: 'jane.smith@company.com',
        displayName: 'Jane Smith',
        mail: 'jane.smith@company.com',
      };

      const mappedProfile = AzureADOAuthProvider.profileMapper(mockProfile);

      expect(mappedProfile).toEqual({
        id: 'azure-user-456',
        username: 'jane.smith@company.com',
        email: 'jane.smith@company.com',
        displayName: 'Jane Smith',
        avatarUrl: undefined,
        raw: mockProfile,
      });
    });

    it('should handle profile with alternative field names', () => {
      const mockProfile = {
        id: 'azure-user-789',
        oid: 'azure-oid-789', // Alternative ID field
        preferred_username: 'preferred.user@company.com',
        name: 'Alternative Name',
        email: 'alt.email@company.com',
      };

      const mappedProfile = AzureADOAuthProvider.profileMapper(mockProfile);

      expect(mappedProfile.id).toBe('azure-user-789');
      expect(mappedProfile.username).toBe('preferred.user@company.com');
      expect(mappedProfile.email).toBe('alt.email@company.com');
      expect(mappedProfile.displayName).toBe('Alternative Name');
    });

    it('should handle profile with missing optional fields', () => {
      const mockProfile = {
        id: 'azure-user-minimal',
      };

      const mappedProfile = AzureADOAuthProvider.profileMapper(mockProfile);

      expect(mappedProfile.id).toBe('azure-user-minimal');
      expect(mappedProfile.username).toBeUndefined();
      expect(mappedProfile.email).toBeUndefined();
      expect(mappedProfile.displayName).toBeUndefined();
      expect(mappedProfile.avatarUrl).toBeUndefined();
      expect(mappedProfile.raw).toBe(mockProfile);
    });

    it('should prioritize _json fields over root fields', () => {
      const mockProfile = {
        id: 'root-id',
        userPrincipalName: 'root@example.com',
        _json: {
          id: 'json-id',
          userPrincipalName: 'json@example.com',
          displayName: 'JSON User',
        },
      };

      const mappedProfile = AzureADOAuthProvider.profileMapper(mockProfile);

      expect(mappedProfile.id).toBe('json-id');
      expect(mappedProfile.username).toBe('json@example.com');
      expect(mappedProfile.displayName).toBe('JSON User');
    });

    it('should handle profile with passport emails array fallback', () => {
      const mockProfile = {
        id: 'passport-user',
        emails: [{ value: 'passport@example.com' }],
        username: 'passport-username',
      };

      const mappedProfile = AzureADOAuthProvider.profileMapper(mockProfile);

      expect(mappedProfile.id).toBe('passport-user');
      expect(mappedProfile.username).toBe('passport-username');
      expect(mappedProfile.email).toBe('passport@example.com');
    });

    it('should handle profile with passport photos array fallback', () => {
      const mockProfile = {
        id: 'photo-user',
        photos: [{ value: 'https://example.com/photo.jpg' }],
      };

      const mappedProfile = AzureADOAuthProvider.profileMapper(mockProfile);

      expect(mappedProfile.id).toBe('photo-user');
      expect(mappedProfile.avatarUrl).toBe('https://example.com/photo.jpg');
    });
  });

  describe('Strategy Class', () => {
    it('should use the correct passport strategy', () => {
      expect(AzureADOAuthProvider.strategy).toBeDefined();
      expect(typeof AzureADOAuthProvider.strategy).toBe('function');
    });
  });
});
