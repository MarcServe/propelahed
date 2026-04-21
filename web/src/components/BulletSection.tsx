type Props = { title: string; items: string[]; emptyNote?: string };

/** Learning store annotates new lines with this prefix; emphasize it in the list. */
function renderBulletLine(item: string) {
  if (item.trimStart().startsWith("New from last article")) {
    return <strong>{item}</strong>;
  }
  return item;
}

export default function BulletSection({ title, items, emptyNote }: Props) {
  if (!items.length) {
    return emptyNote ? (
      <section className="prose-block">
        <h3 className="prose-h3">{title}</h3>
        <p className="prose-muted">{emptyNote}</p>
      </section>
    ) : null;
  }
  return (
    <section className="prose-block">
      <h3 className="prose-h3">{title}</h3>
      <ul className="prose-list">
        {items.map((item) => (
          <li key={item}>{renderBulletLine(item)}</li>
        ))}
      </ul>
    </section>
  );
}
