import { Text as RNText, type TextProps } from 'react-native';

import { type, useColors } from './theme';

type Props = TextProps & { muted?: boolean };

function make(variant: keyof typeof type) {
  return function StyledText({ muted, style, ...rest }: Props) {
    const c = useColors();
    return (
      <RNText {...rest} style={[type[variant], { color: muted ? c.textMuted : c.text }, style]} />
    );
  };
}

export const Title = make('title');
export const Heading = make('heading');
export const Body = make('body');
export const Label = make('label');
export const Caption = make('caption');
