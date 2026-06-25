import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AccountScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email || '');
    }

    loadUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email || '');
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function handleLogOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      Alert.alert('Log out failed', error.message);
      return;
    }

    router.replace('/');
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This will permanently delete your account and all saved flights. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: deleteAccount,
        },
      ]
    );
  }

  async function deleteAccount() {
    const { error } = await supabase.rpc('delete_current_user');

    if (error) {
      Alert.alert('Delete account failed', error.message);
      return;
    }

    await supabase.auth.signOut();
    Alert.alert('Account deleted', 'Your account and saved flights have been deleted.');
    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Account</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Signed in</Text>
          <Text style={styles.bodyText}>{email || 'Not signed in'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>About Flight Tracker</Text>
          <Text style={styles.bodyText}>
            Flight Tracker helps you record your personal flight history, import and export Excel files,
            and view statistics about your journeys.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Developer</Text>
          <Text style={styles.bodyText}>Daniel Pulleiro</Text>
          <Text style={styles.smallText}>
            Developer contact details can be added here before App Store release.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Privacy</Text>
          <Text style={styles.bodyText}>
            Your flight data is private to your account. The app stores the flights you add or import
            so it can show your personal flight history and statistics.
          </Text>
          <Text style={styles.bodyText}>
            We do not sell user data. You can delete your account and saved flights at any time using
            the button below.
          </Text>
        </View>

        <TouchableOpacity style={styles.secondaryButton} onPress={handleLogOut}>
          <Text style={styles.secondaryButtonText}>Log out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dangerButton} onPress={confirmDeleteAccount}>
          <Text style={styles.dangerButtonText}>Delete account</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#eff6ff',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 16,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
    marginBottom: 8,
  },
  smallText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#6b7280',
  },
  secondaryButton: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    marginTop: 6,
    marginBottom: 12,
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
    color: '#991b1b',
    fontSize: 16,
    fontWeight: '900',
  },
});
