import Image from "next/image";

export default function CreatorCard() {
  return (
    <aside className="glass mx-auto mt-16 flex w-full max-w-sm items-center gap-4 rounded-2xl p-4 text-left">
      <Image
        src="/P1.jpg"
        alt="Nilesh S. Sillare"
        width={56}
        height={56}
        className="h-14 w-14 rounded-full object-cover"
      />
      <div>
        <p className="text-xs uppercase tracking-widest text-muted">
          Creator &amp; Developer
        </p>
        <p className="font-semibold">Nilesh S. Sillare</p>
      </div>
    </aside>
  );
}