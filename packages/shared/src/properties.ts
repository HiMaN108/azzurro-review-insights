export interface PropertyConfig {
  slug: string; // Booking.com "pagename"
  name: string; // Name ops staff use
  countryCode: string;
  bookingUrl: string;
}

export const PROPERTIES: PropertyConfig[] = [
  { slug: "olympic-paddington", name: "Olympic Hotel Paddington", countryCode: "au", bookingUrl: "https://www.booking.com/hotel/au/olympic-paddington.html" },
  { slug: "venus-potts-point-sydney", name: "Potts Point", countryCode: "au", bookingUrl: "https://www.booking.com/hotel/au/venus-potts-point-sydney.html" },
  { slug: "venus-surry-hills", name: "Central Sydney", countryCode: "au", bookingUrl: "https://www.booking.com/hotel/au/venus-surry-hills.html" },
  { slug: "chateau-de-venus", name: "Darling Harbour", countryCode: "au", bookingUrl: "https://www.booking.com/hotel/au/chateau-de-venus.html" },
];
