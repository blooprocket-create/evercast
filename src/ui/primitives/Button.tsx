import styles from './Button.module.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'quiet' | 'default';
  /**
   * React 19 passes `ref` as an ordinary prop, so the spread below forwards it
   * without `forwardRef`; it is declared only because
   * `ButtonHTMLAttributes` does not carry it.
   */
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({ variant = 'default', className, ...rest }: ButtonProps) {
  const classes = [styles.button];
  if (variant !== 'default') classes.push(styles[variant]);
  if (className) classes.push(className);
  return <button type="button" {...rest} className={classes.join(' ')} />;
}
