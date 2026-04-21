type Props = { title: string; items: string[]; emptyNote?: string };

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
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
