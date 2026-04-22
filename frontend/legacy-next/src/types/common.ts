export type Role = 'admin' | 'customer';
export type IdentityDocType = 'passport' | 'id_card' | 'driver_license';

export type ProductStatus =
  | 'purchased'
  | 'in_inventory'
  | 'for_sale'
  | 'sold'
  | 'melted'
  | 'undecided';

export type ProductType =
  | 'bracelet'
  | 'ring'
  | 'necklace'
  | 'earring'
  | 'chain'
  | 'bar'
  | 'jewelry';

export type MetalType =
  | 'yellow_gold'
  | 'white_gold'
  | 'silver'
  | 'platinum'
  | 'palladium';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone?: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}
