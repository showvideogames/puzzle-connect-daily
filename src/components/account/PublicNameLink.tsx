import { Link, useInRouterContext } from "react-router-dom";

const url = "/my-puzzles#public-name";

export function PublicNameLink({ className, onClick }: { className: string; onClick?: () => void }) {
  return useInRouterContext()
    ? <Link to={url} className={className} onClick={onClick}>Change Public Name</Link>
    : <a href={url} className={className} onClick={onClick}>Change Public Name</a>;
}
