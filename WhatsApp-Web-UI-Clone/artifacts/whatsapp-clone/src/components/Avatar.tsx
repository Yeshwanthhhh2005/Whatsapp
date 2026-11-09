import { colorFor, initialsOf } from '@/lib/format';

interface Props {
  name: string;
  /** Used to pick a stable colour, so a person looks the same everywhere. */
  id: string;
  imageUrl?: string | null;
  size?: number;
  online?: boolean;
}

export function Avatar({ name, id, imageUrl, size = 42, online = false }: Props) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: imageUrl ? undefined : colorFor(id),
        fontSize: size < 38 ? 12 : 14,
      }}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="avatar-img" />
      ) : (
        initialsOf(name)
      )}
      {online && <span className="online-dot" />}
    </div>
  );
}
