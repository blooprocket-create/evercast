import styles from './Button.module.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'quiet' | 'default';
}

export function Button({ variant = 'default', className, ...rest }: ButtonProps) {
  const classes = [styles.button];
  if (variant !== 'default') classes.push(styles[variant]);
  if (className) classes.push(className);
  return <button type="button" {...rest} className={classes.join(' ')} />;
}
