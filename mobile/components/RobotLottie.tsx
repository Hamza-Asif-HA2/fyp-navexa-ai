import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';
import { theme } from '../constants/theme';

type Props = { state: 'idle' | 'listening' | 'speaking' | 'thinking' };

export default function RobotLottie({ state }: Props) {
  const anim = useRef<LottieView | null>(null);

  const speed = state === 'idle' ? 0.6 : state === 'listening' ? 1.8 : state === 'speaking' ? 2.5 : 0.4;

  useEffect(() => {
    if (!anim.current) return;
    anim.current.play();
  }, [speed]);

  const ringColor =
    state === 'idle'
      ? 'rgba(108,99,255,0.2)'
      : state === 'listening'
      ? 'rgba(0,212,255,0.6)'
      : state === 'speaking'
      ? 'rgba(108,99,255,0.8)'
      : 'rgba(255,200,0,0.4)';

  return (
    <View style={styles.wrapper}>
      <LottieView
        ref={anim}
        source={require('../assets/animations/robot.json')}
        autoPlay
        loop
        speed={speed}
        style={styles.lottie}
      />

      <View style={[styles.ring, { backgroundColor: ringColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center' },
  lottie: { width: 280, height: 280 },
  ring: {
    width: 220,
    height: 22,
    borderRadius: 100,
    marginTop: -16,
    shadowColor: theme.colors.accentPurple,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
});
