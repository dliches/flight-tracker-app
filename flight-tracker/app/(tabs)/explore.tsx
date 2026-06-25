import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import MapView, { Marker, Polyline } from 'react-native-maps';

type Flight = {
  id: string;
  date?: string;
  from: string;
  to: string;
  airline: string;
  seatClass: string;
  purpose: string;
  flightType?: string;
  fromCountry?: string;
  toCountry?: string;
  fromLatitude?: number;
  fromLongitude?: number;
  toLatitude?: number;
  toLongitude?: number;
  distanceKm: number;
  durationMinutes: number;
};

type SupabaseFlightRow = {
  id: string;
  date: string | null;
  from_code: string;
  to_code: string;
  airline: string | null;
  seat_class: string | null;
  purpose: string | null;
  flight_type: string | null;
  from_country: string | null;
  to_country: string | null;
  from_latitude: number | null;
  from_longitude: number | null;
  to_latitude: number | null;
  to_longitude: number | null;
  distance_km: number;
  duration_minutes: number;
};

function rowToFlight(row: SupabaseFlightRow): Flight {
  return {
    id: row.id,
    date: row.date || '',
    from: row.from_code,
    to: row.to_code,
    airline: row.airline || 'Not specified',
    seatClass: row.seat_class || 'Not specified',
    purpose: row.purpose || 'Not specified',
    flightType: row.flight_type || 'Other flights',
    fromCountry: row.from_country || 'Unknown',
    toCountry: row.to_country || 'Unknown',
    fromLatitude: row.from_latitude || undefined,
    fromLongitude: row.from_longitude || undefined,
    toLatitude: row.to_latitude || undefined,
    toLongitude: row.to_longitude || undefined,
    distanceKm: row.distance_km,
    durationMinutes: row.duration_minutes,
  };
}

function getStorageKey(userEmail: string) {
  return `flights:${userEmail.trim().toLowerCase()}`;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;
}

function flightLabel(flight: Flight) {
  return `${flight.from} → ${flight.to}`;
}

function formatSpeed(flight: Flight) {
  if (!flight.durationMinutes) {
    return 0;
  }

  return Math.round(flight.distanceKm / (flight.durationMinutes / 60));
}

function formatPercent(count: number, total: number) {
  if (!total) {
    return '0.0%';
  }

  return `${((count / total) * 100).toFixed(1)}%`;
}

function countItems(items: string[]) {
  const counts: Record<string, number> = {};

  for (const item of items) {
    counts[item] = (counts[item] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

export default function StatisticsScreen() {
  const [email, setEmail] = useState('');
  const [flights, setFlights] = useState<Flight[]>([]);
  const [showMoreAirports, setShowMoreAirports] = useState(false);
  const [showMoreAirlines, setShowMoreAirlines] = useState(false);
  const [showMoreRoutes, setShowMoreRoutes] = useState(false);
  const [showRouteMap, setShowRouteMap] = useState(false);

  useFocusEffect(
    useCallback(() => {
      async function loadStats() {
        const currentUserEmail = await AsyncStorage.getItem('currentUserEmail');

        if (!currentUserEmail) {
          setEmail('');
          setFlights([]);
          return;
        }

        const { data: userData } = await supabase.auth.getUser();

        if (!userData.user) {
          setEmail('');
          setFlights([]);
          return;
        }

        const { data: cloudFlights, error } = await supabase
          .from('flights')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          const savedFlights = await AsyncStorage.getItem(getStorageKey(currentUserEmail));
          setEmail(currentUserEmail);
          setFlights(savedFlights ? JSON.parse(savedFlights) : []);
          return;
        }

        const loadedFlights = (cloudFlights || []).map((row) =>
          rowToFlight(row as SupabaseFlightRow)
        );

        setEmail(currentUserEmail);
        setFlights(loadedFlights);
        await AsyncStorage.setItem(getStorageKey(currentUserEmail), JSON.stringify(loadedFlights));
      }

      loadStats();
    }, [])
  );

  const totalFlights = flights.length;
  const totalKm = flights.reduce((sum, flight) => sum + flight.distanceKm, 0);
  const totalMiles = Math.round(totalKm * 0.621371);
  const totalMinutes = flights.reduce((sum, flight) => sum + flight.durationMinutes, 0);
  const totalHours = totalMinutes ? Math.round(totalMinutes / 60) : 0;
  const totalWeeks = totalMinutes ? totalMinutes / 60 / 24 / 7 : 0;
  const totalMonths = totalMinutes ? totalMinutes / 60 / 24 / 30.44 : 0;

  const longestDistanceFlight = [...flights].sort((a, b) => b.distanceKm - a.distanceKm)[0];
  const shortestDistanceFlight = [...flights].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const longestDurationFlight = [...flights].sort((a, b) => b.durationMinutes - a.durationMinutes)[0];
  const shortestDurationFlight = [...flights].sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
  const fastestFlight = [...flights].sort((a, b) => formatSpeed(b) - formatSpeed(a))[0];
  const slowestFlight = [...flights].sort((a, b) => formatSpeed(a) - formatSpeed(b))[0];

  const averageKm = totalFlights ? Math.round(totalKm / totalFlights) : 0;
  const averageMinutes = totalFlights ? Math.round(totalMinutes / totalFlights) : 0;

  const topAirports = countItems(flights.flatMap((flight) => [flight.from, flight.to]));
  const topAirlines = countItems(flights.map((flight) => flight.airline));
  const topRoutes = countItems(flights.map((flight) => `${flight.from} → ${flight.to}`));
  const visibleTopAirports = totalFlights ? (showMoreAirports ? topAirports.slice(0, 20) : topAirports.slice(0, 10)) : [];
  const visibleTopAirlines = totalFlights ? (showMoreAirlines ? topAirlines.slice(0, 20) : topAirlines.slice(0, 10)) : [];
  const visibleTopRoutes = totalFlights ? (showMoreRoutes ? topRoutes.slice(0, 20) : topRoutes.slice(0, 10)) : [];
  const flightTypes = countItems(flights.map((flight) => flight.flightType || 'Other flights'));
  const seatClasses = countItems(flights.map((flight) => flight.seatClass));
  const flightPurposes = countItems(flights.map((flight) => flight.purpose));

  const airportsVisited = new Set(flights.flatMap((flight) => [flight.from, flight.to])).size;
  const countriesVisitedList = Array.from(
    new Set(
      flights
        .flatMap((flight) => [flight.fromCountry, flight.toCountry])
        .filter((country): country is string => Boolean(country && country !== 'Unknown'))
    )
  ).sort();

  const countriesVisited = countriesVisitedList.length;
  const airlinesFlown = new Set(flights.map((flight) => flight.airline)).size;
  const routesFlown = new Set(flights.map((flight) => `${flight.from} → ${flight.to}`)).size;

  const routeFlights = flights.filter(
    (flight) =>
      typeof flight.fromLatitude === 'number' &&
      typeof flight.fromLongitude === 'number' &&
      typeof flight.toLatitude === 'number' &&
      typeof flight.toLongitude === 'number'
  );

  const uniqueRouteFlights = Array.from(
    new Map(
      routeFlights.map((flight) => {
        const routeKey = [flight.from, flight.to].sort().join('↔');

        return [routeKey, flight];
      })
    ).values()
  );

  const mapPoints = routeFlights.flatMap((flight) => [
    {
      latitude: Number(flight.fromLatitude),
      longitude: Number(flight.fromLongitude),
    },
    {
      latitude: Number(flight.toLatitude),
      longitude: Number(flight.toLongitude),
    },
  ]);

  const mapCenter = mapPoints.length
    ? {
        latitude: mapPoints.reduce((sum, point) => sum + point.latitude, 0) / mapPoints.length,
        longitude: mapPoints.reduce((sum, point) => sum + point.longitude, 0) / mapPoints.length,
      }
    : {
        latitude: 20,
        longitude: 0,
      };

  const airportMarkers = Array.from(
    new Map(
      routeFlights
        .flatMap((flight) => [
          [
            flight.from,
            {
              code: flight.from,
              latitude: Number(flight.fromLatitude),
              longitude: Number(flight.fromLongitude),
            },
          ],
          [
            flight.to,
            {
              code: flight.to,
              latitude: Number(flight.toLatitude),
              longitude: Number(flight.toLongitude),
            },
          ],
        ])
    ).values()
  );

  if (!email) {
    return (
      <View style={styles.centerPage}>
        <Text style={styles.emptyTitle}>No user logged in</Text>
        <Text style={styles.emptyText}>Log in on the FlightData tab to see your statistics.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Text style={styles.title}>Statistics</Text>
      <Text style={styles.signedIn}>Stats for {email}</Text>

      {flights.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No statistics yet</Text>
          <Text style={styles.emptyText}>
            Add flights manually or import your Excel file to generate statistics.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.grid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{totalFlights}</Text>
              <Text style={styles.statLabel}>Flights</Text>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Total Flight Time</Text>

            <View style={styles.compactStatsRow}>
              <Text style={styles.compactStatValue}>{formatDuration(totalMinutes)}</Text>
              <Text style={styles.compactStatValue}>{totalWeeks.toFixed(1)} weeks</Text>
              <Text style={styles.compactStatValue}>{totalMonths.toFixed(1)} months</Text>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Distances</Text>

            <View style={styles.compactStatsColumn}>
              <Text style={styles.compactStatValue}>{totalKm.toLocaleString()} Kilometres</Text>
              <Text style={styles.compactStatValue}>{totalMiles.toLocaleString()} Miles</Text>
              <Text style={styles.compactStatValue}>{(totalKm / 40075).toFixed(2)}x Earth</Text>
              <Text style={styles.compactStatValue}>{(totalKm / 384400).toFixed(3)}x Moon</Text>
              <Text style={styles.compactStatValue}>{(totalKm / 149597870).toFixed(6)}x Sun</Text>
            </View>
          </View>

          {routeFlights.length > 0 && (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Route Map</Text>

              <Text style={styles.rowText}>
                {uniqueRouteFlights.length} unique routes from {routeFlights.length} flights.
              </Text>

              <TouchableOpacity
                style={styles.viewMoreButton}
                onPress={() => setShowRouteMap((visible) => !visible)}
              >
                <Text style={styles.viewMoreButtonText}>
                  {showRouteMap ? 'Hide map' : 'Show map'}
                </Text>
              </TouchableOpacity>

              {showRouteMap && (
                <MapView
                  key={`route-map-${routeFlights.length}-${uniqueRouteFlights.length}`}
                  style={styles.map}
                  initialRegion={{
                    latitude: mapCenter.latitude,
                    longitude: mapCenter.longitude,
                    latitudeDelta: 80,
                    longitudeDelta: 80,
                  }}
                >
                  {uniqueRouteFlights.map((flight) => (
                    <Polyline
                      key={flight.id}
                      coordinates={[
                        {
                          latitude: Number(flight.fromLatitude),
                          longitude: Number(flight.fromLongitude),
                        },
                        {
                          latitude: Number(flight.toLatitude),
                          longitude: Number(flight.toLongitude),
                        },
                      ]}
                      strokeWidth={2}
                    />
                  ))}

                  {airportMarkers.map((airport) => (
                    <Marker
                      key={airport.code}
                      coordinate={{
                        latitude: airport.latitude,
                        longitude: airport.longitude,
                      }}
                      title={airport.code}
                    />
                  ))}
                </MapView>
              )}
            </View>
          )}

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Top Airports</Text>
            {visibleTopAirports.map((airport, index) => (
              <Text key={airport.name} style={styles.rowText}>
                {index + 1}. {airport.name} — {airport.count} — {formatPercent(airport.count, totalFlights * 2)}
              </Text>
            ))}
            {topAirports.length > 10 && (
              <TouchableOpacity
                style={styles.viewMoreButton}
                onPress={() => setShowMoreAirports((visible) => !visible)}
              >
                <Text style={styles.viewMoreButtonText}>
                  {showMoreAirports ? 'View less' : 'View more'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Top Airlines</Text>
            {visibleTopAirlines.map((airline, index) => (
              <Text key={airline.name} style={styles.rowText}>
                {index + 1}. {airline.name} — {airline.count} — {formatPercent(airline.count, totalFlights)}
              </Text>
            ))}
            {topAirlines.length > 10 && (
              <TouchableOpacity
                style={styles.viewMoreButton}
                onPress={() => setShowMoreAirlines((visible) => !visible)}
              >
                <Text style={styles.viewMoreButtonText}>
                  {showMoreAirlines ? 'View less' : 'View more'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Top Routes</Text>
            {visibleTopRoutes.map((route, index) => (
              <Text key={route.name} style={styles.rowText}>
                {index + 1}. {route.name} — {route.count} — {formatPercent(route.count, totalFlights)}
              </Text>
            ))}
            {topRoutes.length > 10 && (
              <TouchableOpacity
                style={styles.viewMoreButton}
                onPress={() => setShowMoreRoutes((visible) => !visible)}
              >
                <Text style={styles.viewMoreButtonText}>
                  {showMoreRoutes ? 'View less' : 'View more'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Flight Extremes</Text>

            {longestDistanceFlight && (
              <Text style={styles.rowText}>
                Longest distance: {longestDistanceFlight.distanceKm.toLocaleString()} km, {formatDuration(longestDistanceFlight.durationMinutes)}, {flightLabel(longestDistanceFlight)}
              </Text>
            )}

            {longestDurationFlight && (
              <Text style={styles.rowText}>
                Longest duration: {formatDuration(longestDurationFlight.durationMinutes)}, {longestDurationFlight.distanceKm.toLocaleString()} km, {flightLabel(longestDurationFlight)}
              </Text>
            )}

            {shortestDistanceFlight && (
              <Text style={styles.rowText}>
                Shortest distance: {shortestDistanceFlight.distanceKm.toLocaleString()} km, {formatDuration(shortestDistanceFlight.durationMinutes)}, {flightLabel(shortestDistanceFlight)}
              </Text>
            )}

            {shortestDurationFlight && (
              <Text style={styles.rowText}>
                Shortest duration: {formatDuration(shortestDurationFlight.durationMinutes)}, {shortestDurationFlight.distanceKm.toLocaleString()} km, {flightLabel(shortestDurationFlight)}
              </Text>
            )}

            {fastestFlight && (
              <Text style={styles.rowText}>
                Fastest flight: {formatSpeed(fastestFlight)} km/h, {fastestFlight.distanceKm.toLocaleString()} km, {formatDuration(fastestFlight.durationMinutes)}, {flightLabel(fastestFlight)}
              </Text>
            )}

            {slowestFlight && (
              <Text style={styles.rowText}>
                Slowest flight: {formatSpeed(slowestFlight)} km/h, {slowestFlight.distanceKm.toLocaleString()} km, {formatDuration(slowestFlight.durationMinutes)}, {flightLabel(slowestFlight)}
              </Text>
            )}

            <Text style={styles.rowText}>
              Average flight: {averageKm.toLocaleString()} km, {formatDuration(averageMinutes)}
            </Text>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Flight Types</Text>
            {flightTypes.map((item) => (
              <Text key={item.name} style={styles.rowText}>
                {item.name}: {item.count}
              </Text>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Seat Classes</Text>
            {seatClasses.map((item) => (
              <Text key={item.name} style={styles.rowText}>
                {item.name}: {item.count}
              </Text>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Flight Purpose</Text>
            {flightPurposes.map((item) => (
              <Text key={item.name} style={styles.rowText}>
                {item.name}: {item.count}
              </Text>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Additional Data</Text>
            <Text style={styles.rowText}>Airports visited: {airportsVisited}</Text>
            <Text style={styles.rowText}>Airlines flown: {airlinesFlown}</Text>
            <Text style={styles.rowText}>Routes flown: {routesFlown}</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centerPage: {
    flex: 1,
    backgroundColor: '#f5f7fb',
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  page: {
    flex: 1,
    backgroundColor: '#f5f7fb',
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  pageContent: {
    paddingBottom: 120,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#111827',
  },
  signedIn: {
    color: '#6b7280',
    marginTop: 4,
    marginBottom: 24,
  },
  emptyCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 23,
  },
  grid: {
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    backgroundColor: 'white',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#2563eb',
  },
  statLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#374151',
    marginTop: 4,
  },
  sectionCard: {
    backgroundColor: 'white',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 14,
  },
  map: {
    height: 320,
    borderRadius: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 12,
  },
  rowText: {
    fontSize: 16,
    color: '#4b5563',
    marginBottom: 8,
  },  compactStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  compactStatsColumn: {
    gap: 8,
  },
  compactStatValue: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    flex: 1,
  },
  viewMoreButton: {
    marginTop: 10,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  viewMoreButtonText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },

});
