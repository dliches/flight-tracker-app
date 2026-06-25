import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Flight = {
  id: string;
  date: string;
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

type Airport = {
  code: string;
  name: string;
  country: string;
  continent: string;
  latitude: number;
  longitude: number;
};

type AirportJsonAirport = {
  name?: string;
  latitude_deg?: string;
  longitude_deg?: string;
  continent?: string;
  iso_country?: string;
  iata_code?: string;
};

const airportData = require('airports-json/data/airports.json') as AirportJsonAirport[];

const airports: Record<string, Airport> = airportData.reduce(
  (airportMap: Record<string, Airport>, airport) => {
    const code = String(airport.iata_code || '').trim().toUpperCase();
    const latitude = Number(airport.latitude_deg);
    const longitude = Number(airport.longitude_deg);

    if (!/^[A-Z]{3}$/.test(code) || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      return airportMap;
    }

    airportMap[code] = {
      code,
      name: airport.name || code,
      country: airport.iso_country || 'Unknown',
      continent: airport.continent || 'Unknown',
      latitude,
      longitude,
    };

    return airportMap;
  },
  {}
);

const historicalAirports: Record<string, Airport> = {
  TXL: {
    code: 'TXL',
    name: 'Berlin Tegel',
    country: 'DE',
    continent: 'EU',
    latitude: 52.5597,
    longitude: 13.2877,
  },
};

Object.assign(airports, historicalAirports);

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(fromAirport: Airport, toAirport: Airport) {
  const earthRadiusKm = 6371;

  const lat1 = degreesToRadians(fromAirport.latitude);
  const lat2 = degreesToRadians(toAirport.latitude);
  const deltaLat = degreesToRadians(toAirport.latitude - fromAirport.latitude);
  const deltaLon = degreesToRadians(toAirport.longitude - fromAirport.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusKm * c);
}

function classifyFlightType(fromAirport: Airport, toAirport: Airport) {
  if (fromAirport.country === toAirport.country) {
    return 'Domestic';
  }

  if (fromAirport.continent === toAirport.continent) {
    return 'Intra-continental';
  }

  return 'Intercontinental';
}

function estimateDurationMinutes(distanceKm: number) {
  const averageSpeedKmH = 800;
  const taxiAndAirportTimeMinutes = 30;

  return Math.round((distanceKm / averageSpeedKmH) * 60 + taxiAndAirportTimeMinutes);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;
}

function getStorageKey(userEmail: string) {
  return `flights:${userEmail.trim().toLowerCase()}`;
}

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getCellByPossibleHeaders(row: Record<string, any>, possibleHeaders: string[]) {
  const rowKeys = Object.keys(row);

  for (const key of rowKeys) {
    const normalizedKey = normalizeHeader(key);

    if (possibleHeaders.some((header) => normalizedKey.includes(header))) {
      const value = row[key];

      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
  }

  return '';
}

function findAirportCodesInRow(row: Record<string, any>) {
  const values = Object.values(row)
    .map((value) => String(value || '').toUpperCase())
    .join(' ');

  const possibleCodes = values.match(/\b[A-Z]{3}\b/g) || [];
  const validCodes: string[] = [];

  for (const code of possibleCodes) {
    if (airports[code] && !validCodes.includes(code)) {
      validCodes.push(code);
    }
  }

  return validCodes;
}

function getImportedSeatClass(row: Record<string, any>) {
  const value = getCellByPossibleHeaders(row, ['class', 'seatclass', 'cabin']);

  if (!value) {
    return 'Not specified';
  }

  const normalized = value.toLowerCase();

  if (normalized.includes('business')) return 'Business';
  if (normalized.includes('first')) return 'First';
  if (normalized.includes('plus') || normalized.includes('premium')) return 'Economy Plus';
  if (normalized.includes('economy')) return 'Economy';

  return value;
}

function getImportedPurpose(row: Record<string, any>) {
  const value = getCellByPossibleHeaders(row, ['purpose', 'reason', 'type']);

  if (!value) {
    return 'Not specified';
  }

  const normalized = value.toLowerCase();

  if (normalized.includes('business') || normalized.includes('work')) return 'Business';
  if (normalized.includes('personal') || normalized.includes('leisure') || normalized.includes('holiday')) {
    return 'Personal';
  }

  return value;
}


export default function AppScreen() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [flights, setFlights] = useState<Flight[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [showFlightForm, setShowFlightForm] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [openFlightMenuId, setOpenFlightMenuId] = useState<string | null>(null);
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);

  const [flightDate, setFlightDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [airline, setAirline] = useState('');
  const [seatClass, setSeatClass] = useState('Economy');
  const [purpose, setPurpose] = useState('Personal');

  useEffect(() => {
    async function restoreSession() {
      const { data: sessionData } = await supabase.auth.getSession();

      if (!sessionData.session?.user) {
        return;
      }

      const sessionUser = sessionData.session.user;
      const sessionEmail = sessionUser.email || '';

      const { data: cloudFlights, error } = await supabase
        .from('flights')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        return;
      }

      const loadedFlights = (cloudFlights || []).map((row) =>
        rowToFlight(row as SupabaseFlightRow)
      );

      setUserId(sessionUser.id);
      setEmail(sessionEmail);
      setFlights(loadedFlights);
      setIsLoggedIn(true);
      await AsyncStorage.setItem('currentUserEmail', sessionEmail);
      await AsyncStorage.setItem(getStorageKey(sessionEmail), JSON.stringify(loadedFlights));
    }

    restoreSession();
  }, []);

  async function handleLoginOrSignup() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      Alert.alert('Missing details', 'Please enter your email and password.');
      return;
    }

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (error) {
          Alert.alert('Sign up failed', error.message);
          return;
        }

        Alert.alert(
          'Account created',
          'Your account has been created. If Supabase asks for email confirmation, check your inbox, then log in.'
        );

        setMode('login');
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        Alert.alert('Login failed', error.message);
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData.user) {
        Alert.alert('Login failed', 'Could not find the logged-in user.');
        return;
      }

      const { data: cloudFlights, error: flightsError } = await supabase
        .from('flights')
        .select('*')
        .order('created_at', { ascending: false });

      if (flightsError) {
        Alert.alert('Cloud load failed', flightsError.message);
        return;
      }

      const loadedFlights = (cloudFlights || []).map((row) =>
        rowToFlight(row as SupabaseFlightRow)
      );

      setUserId(userData.user.id);
      setEmail(cleanEmail);
      setFlights(loadedFlights);
      await AsyncStorage.setItem('currentUserEmail', cleanEmail);
      await AsyncStorage.setItem(getStorageKey(cleanEmail), JSON.stringify(loadedFlights));
      setIsLoggedIn(true);
    } catch {
      Alert.alert('Login error', 'Something went wrong while connecting to Supabase.');
    }
  }

  async function handleForgotPassword() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      Alert.alert('Email required', 'Enter your email address first, then tap Forgot password.');
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);

    if (error) {
      Alert.alert('Password reset failed', error.message);
      return;
    }

    Alert.alert(
      'Password reset sent',
      'Check your email for the password reset link.'
    );
  }

  function resetFlightForm() {
    setFlightDate('');
    setFrom('');
    setTo('');
    setAirline('');
    setSeatClass('Economy');
    setPurpose('Personal');
    setEditingFlightId(null);
  }

  function openAddFlightForm() {
    resetFlightForm();
    setShowFlightForm(true);
  }

  async function handleSaveFlight() {
    if (!userId) {
      Alert.alert('Not logged in', 'Please log in again before saving flights.');
      return;
    }

    const fromCode = from.trim().toUpperCase();
    const toCode = to.trim().toUpperCase();
    const cleanAirline = airline.trim();

    if (!fromCode || !toCode) {
      Alert.alert('Missing details', 'Please enter origin and destination airport codes.');
      return;
    }

    const fromAirport = airports[fromCode];
    const toAirport = airports[toCode];

    if (!fromAirport || !toAirport) {
      Alert.alert('Airport not found', 'Please check the airport codes and try again.');
      return;
    }

    const distanceKm = calculateDistanceKm(fromAirport, toAirport);
    const durationMinutes = estimateDurationMinutes(distanceKm);
    const flightType = classifyFlightType(fromAirport, toAirport);

    const flightPayload = {
      user_id: userId,
      date: flightDate.trim() || null,
      from_code: fromCode,
      to_code: toCode,
      airline: cleanAirline || 'Not specified',
      seat_class: seatClass || 'Not specified',
      purpose: purpose || 'Not specified',
      flight_type: flightType,
      from_country: fromAirport.country,
      to_country: toAirport.country,
      from_latitude: fromAirport.latitude,
      from_longitude: fromAirport.longitude,
      to_latitude: toAirport.latitude,
      to_longitude: toAirport.longitude,
      distance_km: distanceKm,
      duration_minutes: durationMinutes,
    };

    if (editingFlightId) {
      const { data, error } = await supabase
        .from('flights')
        .update({
          ...flightPayload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingFlightId)
        .select()
        .single();

      if (error) {
        Alert.alert('Save failed', error.message);
        return;
      }

      const updatedFlight = rowToFlight(data as SupabaseFlightRow);

      setFlights(
        flights.map((flight) =>
          flight.id === editingFlightId ? updatedFlight : flight
        )
      );
    } else {
      const { data, error } = await supabase
        .from('flights')
        .insert(flightPayload)
        .select()
        .single();

      if (error) {
        Alert.alert('Save failed', error.message);
        return;
      }

      const savedFlight = rowToFlight(data as SupabaseFlightRow);

      setFlights([savedFlight, ...flights]);
    }

    resetFlightForm();
    setShowFlightForm(false);
  }

  function handleEditFlight(flight: Flight) {
    setEditingFlightId(flight.id);
    setFlightDate(flight.date || '');
    setFrom(flight.from);
    setTo(flight.to);
    setAirline(flight.airline);
    setSeatClass(flight.seatClass);
    setPurpose(flight.purpose);
    setShowFlightForm(true);
  }

  function handleDeleteFlight(id: string) {
    Alert.alert('Delete flight', 'Are you sure you want to delete this flight?', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('flights')
            .delete()
            .eq('id', id);

          if (error) {
            Alert.alert('Delete failed', error.message);
            return;
          }

          setFlights(flights.filter((flight) => flight.id !== id));
        },
      },
    ]);
  }

  async function handleImportExcel() {
    if (!userId) {
      Alert.alert('Not logged in', 'Please log in again before importing flights.');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const file = result.assets[0];

      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const workbook = XLSX.read(base64, { type: 'base64' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];

      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

      if (!rows.length) {
        Alert.alert('Import failed', 'No rows were found in this Excel file.');
        return;
      }

      const importedFlights: Flight[] = [];
      const skippedRows: string[] = [];

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const excelRowNumber = rowIndex + 2;
        const headerFrom = getCellByPossibleHeaders(row, ['from', 'origin', 'departure', 'depart', 'dep']);
        const headerTo = getCellByPossibleHeaders(row, ['to', 'destination', 'arrival', 'arrive', 'arr']);

        const detectedCodes = findAirportCodesInRow(row);

        const fromCode = String(headerFrom || detectedCodes[0] || '').trim().toUpperCase();
        const toCode = String(headerTo || detectedCodes.find((code) => code !== fromCode) || '').trim().toUpperCase();

        if (!fromCode || !toCode) {
          skippedRows.push(`Row ${excelRowNumber}: could not find two airport codes`);
          continue;
        }

        const fromAirport = airports[fromCode];
        const toAirport = airports[toCode];

        if (!fromAirport || !toAirport) {
          skippedRows.push(`Row ${excelRowNumber}: airport not recognised (${fromCode} → ${toCode})`);
          continue;
        }

        const cleanAirline = getCellByPossibleHeaders(row, ['airline', 'carrier', 'company', 'operator']);
        const importedDate = getCellByPossibleHeaders(row, ['date', 'flightdate']);
        const importedClass = getImportedSeatClass(row);
        const importedPurpose = getImportedPurpose(row);

        const distanceKm = calculateDistanceKm(fromAirport, toAirport);
        const durationMinutes = estimateDurationMinutes(distanceKm);
        const flightType = classifyFlightType(fromAirport, toAirport);

        importedFlights.push({
          id: `${Date.now()}-${importedFlights.length}`,
          date: importedDate,
          from: fromCode,
          to: toCode,
          airline: cleanAirline || 'Not specified',
          seatClass: importedClass || 'Not specified',
          purpose: importedPurpose || 'Not specified',
          flightType,
          fromCountry: fromAirport.country,
          toCountry: toAirport.country,
          fromLatitude: fromAirport.latitude,
          fromLongitude: fromAirport.longitude,
          toLatitude: toAirport.latitude,
          toLongitude: toAirport.longitude,
          distanceKm,
          durationMinutes,
        });
      }

      if (!importedFlights.length) {
        Alert.alert(
          'Import failed',
          'The file was read, but no valid flights were found. We may need to map your Excel column names.'
        );
        return;
      }

      const newImportedFlights = importedFlights;

      const skippedPreview = skippedRows.slice(0, 8).join('\n');
      const previewMessage =
        `${newImportedFlights.length} flights found.\n` +
        `${skippedRows.length} rows skipped.\n\n` +
        `${skippedPreview}`;

      Alert.alert(
        'Import preview',
        previewMessage,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Import',
            onPress: async () => {
              let savedImportedFlights: Flight[] = [];

              if (newImportedFlights.length > 0) {
                const rowsToInsert = newImportedFlights.map((flight) => ({
                  user_id: userId,
                  date: flight.date || null,
                  from_code: flight.from,
                  to_code: flight.to,
                  airline: flight.airline || 'Not specified',
                  seat_class: flight.seatClass || 'Not specified',
                  purpose: flight.purpose || 'Not specified',
                  flight_type: flight.flightType || 'Other flights',
                  from_country: flight.fromCountry || null,
                  to_country: flight.toCountry || null,
                  from_latitude: flight.fromLatitude || null,
                  from_longitude: flight.fromLongitude || null,
                  to_latitude: flight.toLatitude || null,
                  to_longitude: flight.toLongitude || null,
                  distance_km: flight.distanceKm,
                  duration_minutes: flight.durationMinutes,
                }));

                const { data, error } = await supabase
                  .from('flights')
                  .insert(rowsToInsert)
                  .select();

                if (error) {
                  Alert.alert('Cloud import failed', error.message);
                  return;
                }

                savedImportedFlights = (data || []).map((row) =>
                  rowToFlight(row as SupabaseFlightRow)
                );
              }

              setFlights([...savedImportedFlights, ...flights]);

              Alert.alert(
                'Import complete',
                `${savedImportedFlights.length} flights imported.\n${skippedRows.length} rows skipped.`
              );
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Import error', 'The Excel file could not be imported.');
    }
  }

  async function handleExportExcel() {
    if (!flights.length) {
      Alert.alert('No flights', 'There are no flights to export.');
      return;
    }

    try {
      const exportRows = flights.map((flight, index) => ({
        Number: index + 1,
        Date: flight.date || '',
        Departure: flight.from,
        Destination: flight.to,
        Airline: flight.airline || '',
        Class: flight.seatClass || '',
        Purpose: flight.purpose || '',
        Type: flight.flightType || '',
        'Distance KM': flight.distanceKm,
        'Duration Minutes': flight.durationMinutes,
        'From Country': flight.fromCountry || '',
        'To Country': flight.toCountry || '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Flights');

      const base64 = XLSX.write(workbook, {
        type: 'base64',
        bookType: 'xlsx',
      });

      const fileUri = `${FileSystem.documentDirectory}flight-tracker-export.xlsx`;

      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert('Export ready', `File saved to: ${fileUri}`);
        return;
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Export flights',
        UTI: 'com.microsoft.excel.xlsx',
      });
    } catch {
      Alert.alert('Export failed', 'Could not export your flights to Excel.');
    }
  }

  function handleClearAllFlights() {
    if (!userId) {
      Alert.alert('Not logged in', 'Please log in again before clearing flights.');
      return;
    }

    Alert.alert(
      'Clear all flights',
      'This will permanently delete all flights saved in the cloud for this account.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('flights')
              .delete()
              .eq('user_id', userId);

            if (error) {
              Alert.alert('Clear failed', error.message);
              return;
            }

            setFlights([]);
            await AsyncStorage.setItem(getStorageKey(email), JSON.stringify([]));
          },
        },
      ]
    );
  }

  async function handleLogout() {
    await AsyncStorage.removeItem('currentUserEmail');
    await supabase.auth.signOut();
    setUserId(null);
    setIsLoggedIn(false);
    setFlights([]);
    setShowFlightForm(false);
    resetFlightForm();
  }

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={styles.loginContent}
          >
            <Text style={styles.logo}>Flight Tracker</Text>

            <Text style={styles.subtitle}>
              Track your flights, import your Excel history, and view your travel statistics.
            </Text>

            <View style={styles.card}>
              <View style={styles.switchRow}>
                <TouchableOpacity
                  style={[styles.switchButton, mode === 'login' && styles.switchButtonActive]}
                  onPress={() => setMode('login')}
                >
                  <Text style={[styles.switchText, mode === 'login' && styles.switchTextActive]}>
                    Login
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.switchButton, mode === 'signup' && styles.switchButtonActive]}
                  onPress={() => setMode('signup')}
                >
                  <Text style={[styles.switchText, mode === 'signup' && styles.switchTextActive]}>
                    Sign up
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <TouchableOpacity style={styles.primaryButton} onPress={handleLoginOrSignup}>
                <Text style={styles.primaryButtonText}>
                  {mode === 'login' ? 'Login' : 'Create account'}
                </Text>
              </TouchableOpacity>

              {mode === 'login' && (
                <TouchableOpacity style={styles.forgotButton} onPress={handleForgotPassword}>
                  <Text style={styles.forgotButtonText}>Forgot password?</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.note}>
              Your account starts empty. You can import your own Excel file later.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.flightContent}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerTextBox}>
              <Text style={styles.title}>FlightData</Text>
              <Text style={styles.signedIn}>Signed in as {email}</Text>
            </View>

            <View style={styles.optionsWrapper}>
              <TouchableOpacity
                style={styles.optionsButton}
                onPress={() => setShowOptionsMenu((visible) => !visible)}
              >
                <Text style={styles.optionsButtonText}>Options</Text>
              </TouchableOpacity>

              {showOptionsMenu && (
                <View style={styles.optionsMenu}>
                  <TouchableOpacity
                    style={styles.optionsMenuItem}
                    onPress={() => {
                      setShowOptionsMenu(false);
                      handleImportExcel();
                    }}
                  >
                    <Text style={styles.optionsMenuText}>Import Excel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.optionsMenuItem}
                    onPress={() => {
                      setShowOptionsMenu(false);
                      handleExportExcel();
                    }}
                  >
                    <Text style={styles.optionsMenuText}>Export Excel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.optionsMenuItem}
                    onPress={() => {
                      setShowOptionsMenu(false);
                      handleClearAllFlights();
                    }}
                  >
                    <Text style={styles.optionsDangerText}>Clear all flights</Text>
                  </TouchableOpacity>

                  <View style={styles.optionsDivider} />

                  <TouchableOpacity
                    style={styles.optionsMenuItem}
                    onPress={() => {
                      setShowOptionsMenu(false);
                      handleLogout();
                    }}
                  >
                    <Text style={styles.optionsMenuText}>Log out</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {!showFlightForm && (
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => {
                  setShowOptionsMenu(false);
                  openAddFlightForm();
                }}
              >
                <Text style={styles.primaryButtonText}>Add Flight</Text>
              </TouchableOpacity>
            </View>
          )}

          {showFlightForm && (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>
                {editingFlightId ? 'Edit flight' : 'Add new flight'}
              </Text>

              <Text style={styles.label}>Date</Text>
              <TextInput
                style={styles.input}
                placeholder="Example: 2026-06-24"
                value={flightDate}
                onChangeText={setFlightDate}
              />

              <Text style={styles.label}>Origin airport code</Text>
              <TextInput
                style={styles.input}
                placeholder="Example: LHR"
                autoCapitalize="characters"
                value={from}
                onChangeText={setFrom}
              />

              <Text style={styles.label}>Destination airport code</Text>
              <TextInput
                style={styles.input}
                placeholder="Example: JFK"
                autoCapitalize="characters"
                value={to}
                onChangeText={setTo}
              />

              <Text style={styles.label}>Airline</Text>
              <TextInput
                style={styles.input}
                placeholder="Example: British Airways"
                value={airline}
                onChangeText={setAirline}
              />

              <Text style={styles.label}>Seat class</Text>
              <View style={styles.choiceGrid}>
                {['Economy', 'Economy Plus', 'Business', 'First'].map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={[styles.choiceButton, seatClass === item && styles.choiceButtonActive]}
                    onPress={() => setSeatClass(item)}
                  >
                    <Text
                      style={[styles.choiceText, seatClass === item && styles.choiceTextActive]}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Purpose</Text>
              <View style={styles.choiceGrid}>
                {['Personal', 'Business'].map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={[styles.choiceButton, purpose === item && styles.choiceButtonActive]}
                    onPress={() => setPurpose(item)}
                  >
                    <Text style={[styles.choiceText, purpose === item && styles.choiceTextActive]}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.primaryButton} onPress={handleSaveFlight}>
                <Text style={styles.primaryButtonText}>
                  {editingFlightId ? 'Save Changes' : 'Save Flight'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  resetFlightForm();
                  setShowFlightForm(false);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {!showFlightForm && flights.length === 0 && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No flights yet</Text>
              <Text style={styles.emptyText}>
                Start by adding your first flight manually or importing your existing Excel file.
              </Text>
            </View>
          )}

          {!showFlightForm &&
            flights.map((flight) => (
              <View
                key={flight.id}
                style={[
                  styles.flightCard,
                  openFlightMenuId === flight.id && styles.flightCardOpen,
                ]}
              >
                <View style={styles.flightTopRow}>
                  <Text style={styles.routeText}>
                    {flight.from} → {flight.to}
                  </Text>

                  <View style={styles.flightMetrics}>
                    <Text style={styles.distanceText}>{flight.distanceKm.toLocaleString()} km</Text>
                    <Text style={styles.durationText}>{formatDuration(flight.durationMinutes)}</Text>
                  </View>

                  <View style={styles.flightMenuWrapper}>
                    <TouchableOpacity
                      style={styles.flightMenuButton}
                      onPress={() =>
                        setOpenFlightMenuId((currentId) =>
                          currentId === flight.id ? null : flight.id
                        )
                      }
                    >
                      <Text style={styles.flightMenuButtonText}>...</Text>
                    </TouchableOpacity>

                    {openFlightMenuId === flight.id && (
                      <View style={styles.flightMenu}>
                        <TouchableOpacity
                          style={styles.flightMenuItem}
                          onPress={() => {
                            setOpenFlightMenuId(null);
                            handleEditFlight(flight);
                          }}
                        >
                          <Text style={styles.flightMenuText}>Edit</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.flightMenuItem}
                          onPress={() => {
                            setOpenFlightMenuId(null);
                            handleDeleteFlight(flight.id);
                          }}
                        >
                          <Text style={styles.flightMenuDangerText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>

                {[
                  flight.airline,
                  flight.seatClass,
                  flight.purpose,
                  flight.date,
                ].filter((detail) => detail && detail !== 'Not specified').length > 0 && (
                  <Text style={styles.flightMeta}>
                    {[
                      flight.airline,
                      flight.seatClass,
                      flight.purpose,
                      flight.date,
                    ]
                      .filter((detail) => detail && detail !== 'Not specified')
                      .join(' · ')}
                  </Text>
                )}
              </View>
            ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f7fb',
  },
  loginContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 140,
  },
  flightContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 140,
  },
  logo: {
    fontSize: 36,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#4b5563',
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 23,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  switchRow: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  switchButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 11,
    alignItems: 'center',
  },
  switchButtonActive: {
    backgroundColor: '#2563eb',
  },
  switchText: {
    fontWeight: '800',
    color: '#374151',
  },
  switchTextActive: {
    color: 'white',
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '900',
  },
  forgotButton: {
    padding: 14,
    alignItems: 'center',
  },
  forgotButtonText: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  secondaryButtonText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
  },
  dangerButton: {
    backgroundColor: '#fee2e2',
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  dangerButtonText: {
    color: '#b91c1c',
    fontSize: 16,
    fontWeight: '900',
  },
  note: {
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 14,
    marginTop: 22,
    lineHeight: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerTextBox: {
    flex: 1,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#111827',
  },
  signedIn: {
    color: '#6b7280',
    marginTop: 4,
  },
  optionsWrapper: {
    position: 'relative',
    alignItems: 'flex-end',
    zIndex: 20,
  },
  optionsButton: {
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  optionsButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  optionsMenu: {
    position: 'absolute',
    top: 46,
    right: 0,
    width: 190,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 30,
  },
  optionsMenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionsMenuText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
  },
  optionsDangerText: {
    color: '#dc2626',
    fontSize: 15,
    fontWeight: '700',
  },
  optionsDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 4,
  },
  actionsRow: {
    gap: 12,
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
  formCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 18,
  },
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  choiceButton: {
    backgroundColor: '#e5e7eb',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  choiceButtonActive: {
    backgroundColor: '#2563eb',
  },
  choiceText: {
    fontWeight: '800',
    color: '#374151',
  },
  choiceTextActive: {
    color: 'white',
  },
  cancelButton: {
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  cancelButtonText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '900',
  },
  flightCard: {
    backgroundColor: 'white',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 10,
    position: 'relative',
    zIndex: 1,
    overflow: 'visible',
  },
  flightCardOpen: {
    zIndex: 999,
    elevation: 20,
  },
  flightTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 6,
    zIndex: 10,
  },
  routeText: {
    flex: 1,
    fontSize: 19,
    fontWeight: '900',
    color: '#111827',
  },
  flightMetrics: {
    width: 86,
    alignItems: 'center',
    paddingTop: 1,
  },
  distanceText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#2563eb',
    textAlign: 'center',
  },
  durationText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    marginTop: 2,
    textAlign: 'center',
  },
  flightMenuWrapper: {
    width: 40,
    alignItems: 'flex-end',
    position: 'relative',
    zIndex: 20,
  },
  flightMenuButton: {
    minWidth: 34,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flightMenuButtonText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
    marginTop: -6,
  },
  flightMenu: {
    position: 'absolute',
    top: 34,
    right: 0,
    width: 110,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 30,
    zIndex: 1000,
  },
  flightMenuItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  flightMenuText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  flightMenuDangerText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '800',
  },
  flightMeta: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 2,
  },
  flightDetail: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 3,
  },
  flightActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  editFlightButton: {
    backgroundColor: '#e0ecff',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  editFlightButtonText: {
    color: '#1d4ed8',
    fontWeight: '900',
  },
  deleteFlightButton: {
    backgroundColor: '#fee2e2',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  deleteFlightButtonText: {
    color: '#b91c1c',
    fontWeight: '900',
  },
});
