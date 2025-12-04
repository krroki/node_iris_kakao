from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import BigInteger, Text, Integer, DateTime
from typing import Optional


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "sources_post"
    post_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    cafe_id: Mapped[int] = mapped_column(BigInteger)
    menu_id: Mapped[int] = mapped_column(BigInteger)
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    author: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    html: Mapped[Optional[str]] = mapped_column(Text)
    norm_text: Mapped[Optional[str]] = mapped_column(Text)
    text_hash: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[Optional[str]] = mapped_column(Text)
    dedup_key: Mapped[Optional[str]] = mapped_column(Text)
    rule_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    last_crawled_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))


class Manual(Base):
    __tablename__ = "manual_doc"
    doc_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    slug: Mapped[Optional[str]] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    body_md: Mapped[str] = mapped_column(Text)
    summary: Mapped[Optional[str]] = mapped_column(Text)
    level: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[Optional[str]] = mapped_column(Text)
    version: Mapped[Optional[int]] = mapped_column(Integer)

