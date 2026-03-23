export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserPublic {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
}

export interface UserProfile extends UserPublic {
  bio: string | null;
  roles: string[];
  lastLoginAt: Date | null;
  updatedAt: Date;
}

export interface AuthResult {
  user: UserPublic;
  tokens: AuthTokens;
}

export interface TokenUser {
  id: string;
  email: string;
  username: string;
}
