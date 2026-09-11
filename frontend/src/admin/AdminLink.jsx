/**
 * A link between admin pages. It switches pages in place, so a passcode
 * sign-in (which is never stored) survives moving around; a modified click
 * still opens a new tab as usual.
 */
export default function AdminLink({ to, onNavigate, children, ...rest }) {
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    onNavigate(to);
  }

  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
