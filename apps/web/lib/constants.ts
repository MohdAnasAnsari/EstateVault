import type { AssetType, ComparableSale } from '@vault/types';
import {
  Building2,
  Castle,
  Gem,
  Hotel,
  Landmark,
  Map,
  Palmtree,
} from 'lucide-react';

export const assetCategoryMeta: Array<{
  label: string;
  value: AssetType;
  icon: typeof Hotel;
}> = [
  { label: 'Hotel', value: 'hotel', icon: Hotel },
  { label: 'Palace', value: 'palace', icon: Castle },
  { label: 'Plot', value: 'development_plot', icon: Map },
  { label: 'Island', value: 'private_island', icon: Palmtree },
  { label: 'Residence', value: 'penthouse_tower', icon: Building2 },
  { label: 'Villa', value: 'villa', icon: Landmark },
];

export const valueProps = [
  'Private identity',
  'Verified assets',
  'Encrypted deals',
];

export const comparableSalesByAssetType: Record<AssetType, ComparableSale[]> = {
  hotel: [
    { id: 'h1', title: 'Marina Crest Hotel', location: 'Dubai Marina', soldPrice: 214000000, currency: 'AED', soldAt: '2025-09-18' },
    { id: 'h2', title: 'Azure Corniche Hotel', location: 'Abu Dhabi', soldPrice: 301000000, currency: 'AED', soldAt: '2025-11-04' },
    { id: 'h3', title: 'Maldives Atoll Reserve', location: 'Maldives', soldPrice: 188000000, currency: 'USD', soldAt: '2025-08-12' },
  ],
  palace: [
    { id: 'p1', title: 'Najd Royal Estate', location: 'Riyadh', soldPrice: 340000000, currency: 'SAR', soldAt: '2025-07-09' },
    { id: 'p2', title: 'Imperial Bosphorus Manor', location: 'Istanbul', soldPrice: 146000000, currency: 'USD', soldAt: '2025-06-15' },
    { id: 'p3', title: 'Baroque Garden Palace', location: 'Vienna', soldPrice: 121000000, currency: 'EUR', soldAt: '2025-05-28' },
  ],
  heritage_estate: [
    { id: 'he1', title: 'Historic Manor', location: 'Florence', soldPrice: 42000000, currency: 'EUR', soldAt: '2025-10-08' },
    { id: 'he2', title: 'Cotswolds Estate', location: 'Oxford', soldPrice: 53000000, currency: 'GBP', soldAt: '2025-09-21' },
    { id: 'he3', title: 'Provencal Chateau', location: 'Provence', soldPrice: 61000000, currency: 'EUR', soldAt: '2025-04-30' },
  ],
  development_plot: [
    { id: 'dp1', title: 'Waterfront Mixed-Use Plot', location: 'Dubai', soldPrice: 88000000, currency: 'AED', soldAt: '2025-08-02' },
    { id: 'dp2', title: 'NEOM Hospitality Parcel', location: 'Tabuk', soldPrice: 76000000, currency: 'SAR', soldAt: '2025-10-12' },
    { id: 'dp3', title: 'Riviera Residential Site', location: 'Athens', soldPrice: 32000000, currency: 'EUR', soldAt: '2025-07-27' },
  ],
  penthouse_tower: [
    { id: 'pt1', title: 'Skyline Crown Penthouse', location: 'Dubai', soldPrice: 98000000, currency: 'AED', soldAt: '2025-11-12' },
    { id: 'pt2', title: 'Knightsbridge Apex Residence', location: 'London', soldPrice: 82000000, currency: 'GBP', soldAt: '2025-06-10' },
    { id: 'pt3', title: 'Central Park Summit', location: 'New York', soldPrice: 47000000, currency: 'USD', soldAt: '2025-08-20' },
  ],
  private_island: [
    { id: 'pi1', title: 'Lagoon Crest Island', location: 'Maldives', soldPrice: 124000000, currency: 'USD', soldAt: '2025-09-14' },
    { id: 'pi2', title: 'Cyclades Reserve', location: 'Greece', soldPrice: 76000000, currency: 'EUR', soldAt: '2025-05-22' },
    { id: 'pi3', title: 'Caribbean Cay', location: 'Turks and Caicos', soldPrice: 98000000, currency: 'USD', soldAt: '2025-10-01' },
  ],
  branded_residence: [
    { id: 'br1', title: 'Harbor Signature Residence', location: 'Dubai', soldPrice: 25000000, currency: 'AED', soldAt: '2025-03-10' },
    { id: 'br2', title: 'Marina Flagship Residence', location: 'Monaco', soldPrice: 39000000, currency: 'EUR', soldAt: '2025-04-24' },
    { id: 'br3', title: 'Ultra Prime Residence', location: 'Miami', soldPrice: 21000000, currency: 'USD', soldAt: '2025-09-02' },
  ],
  villa: [
    { id: 'v1', title: 'Golf Crest Mansion', location: 'Dubai Hills', soldPrice: 69000000, currency: 'AED', soldAt: '2025-11-01' },
    { id: 'v2', title: 'Mediterranean Cliff Estate', location: 'Nice', soldPrice: 47000000, currency: 'EUR', soldAt: '2025-09-19' },
    { id: 'v3', title: 'Tuscan Vineyard Villa', location: 'Tuscany', soldPrice: 23000000, currency: 'EUR', soldAt: '2025-07-06' },
  ],
  commercial_building: [
    { id: 'cb1', title: 'Prime Office Tower', location: 'Dubai', soldPrice: 126000000, currency: 'AED', soldAt: '2025-08-11' },
    { id: 'cb2', title: 'Mixed Use Block', location: 'London', soldPrice: 91000000, currency: 'GBP', soldAt: '2025-03-18' },
    { id: 'cb3', title: 'Harbor Building', location: 'Singapore', soldPrice: 104000000, currency: 'SGD', soldAt: '2025-10-26' },
  ],
  golf_resort: [
    { id: 'gr1', title: 'Lakeside Golf Resort', location: 'Dubai', soldPrice: 232000000, currency: 'AED', soldAt: '2025-08-29' },
    { id: 'gr2', title: 'Mediterranean Fairway Club', location: 'Marbella', soldPrice: 138000000, currency: 'EUR', soldAt: '2025-06-13' },
    { id: 'gr3', title: 'Mountain Golf Retreat', location: 'Aspen', soldPrice: 162000000, currency: 'USD', soldAt: '2025-10-07' },
  ],
  other: [
    { id: 'o1', title: 'Specialty Trophy Asset', location: 'Dubai', soldPrice: 42000000, currency: 'AED', soldAt: '2025-07-14' },
    { id: 'o2', title: 'Destination Estate', location: 'Athens', soldPrice: 29000000, currency: 'EUR', soldAt: '2025-03-03' },
    { id: 'o3', title: 'Prestige Compound', location: 'Riyadh', soldPrice: 66000000, currency: 'SAR', soldAt: '2025-09-28' },
  ],
};

export const dashboardHighlights = [
  { title: 'Matched listings', icon: Gem, value: 'Top 5 AI-ranked opportunities' },
  { title: 'Deal rooms', icon: Building2, value: 'Stubbed for Phase 1' },
  { title: 'KYC progress', icon: Landmark, value: 'Identity tiering ready' },
];
