export interface SafeUser {
  userId: number;
  ssoUserId: number | null;
  tenantId: number | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  lastLoggedInAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface InvitedUser extends SafeUser {
  roleName: string;
}
