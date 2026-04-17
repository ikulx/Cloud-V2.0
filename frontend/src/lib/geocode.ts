/**
 * Geocoding via OpenStreetMap Nominatim (kostenlos, kein API-Key).
 * Nutzungsrichtlinien: https://operations.osmfoundation.org/policies/nominatim/
 * - Max. 1 Request/Sekunde
 * - User-Agent setzen
 */

export interface GeocodeResult {
  latitude: number
  longitude: number
}

export interface AddressInput {
  street?: string | null
  zip?: string | null
  city?: string | null
  country?: string | null
}

/**
 * Fragt Nominatim nach Koordinaten für eine Adresse.
 * Gibt null zurück wenn keine Treffer oder Netzwerkfehler.
 */
export async function geocodeAddress(addr: AddressInput): Promise<GeocodeResult | null> {
  const parts = [addr.street, addr.zip, addr.city, addr.country].filter((p) => p && p.trim())
  if (parts.length === 0) return null

  const q = parts.join(', ')
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (!Array.isArray(data) || data.length === 0) return null
    const { lat, lon } = data[0]
    const latitude = parseFloat(lat)
    const longitude = parseFloat(lon)
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null
    return { latitude, longitude }
  } catch {
    return null
  }
}
