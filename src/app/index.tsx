import { Redirect } from 'expo-router';

/**
 * Root route: always land on the Shows tab. This file intentionally owns
 * the "/" path so no starter/onboarding content can ever render there.
 */
export default function Index() {
  return <Redirect href="/(tabs)/shows" />;
}
