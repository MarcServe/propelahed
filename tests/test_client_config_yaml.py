"""ClientConfig.from_yaml tolerates topic lists stored as YAML strings."""

from pathlib import Path

from seo_engine.engine.state import ClientConfig


def test_from_yaml_topic_cluster_as_multiline_string(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        """
client_id: tc-str
domain: example.com
topic_cluster: |
  First line topic
  Second line topic
target_audience: devs
tone: neutral
publish_destination: LOCAL_MARKDOWN
output_dir: /tmp/out
""".strip(),
        encoding="utf-8",
    )
    cfg = ClientConfig.from_yaml(path)
    assert cfg.topic_cluster == ["First line topic", "Second line topic"]


def test_from_yaml_topic_cluster_as_comma_string(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        """
client_id: tc-csv
domain: example.com
topic_cluster: "Alpha, Beta, Gamma"
target_audience: devs
tone: neutral
publish_destination: LOCAL_MARKDOWN
output_dir: /tmp/out
""".strip(),
        encoding="utf-8",
    )
    cfg = ClientConfig.from_yaml(path)
    assert cfg.topic_cluster == ["Alpha", "Beta", "Gamma"]


def test_from_yaml_excluded_topics_as_string(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        """
client_id: ex-str
domain: example.com
topic_cluster: "x"
excluded_topics: "spam, noise"
target_audience: devs
tone: neutral
publish_destination: LOCAL_MARKDOWN
output_dir: /tmp/out
""".strip(),
        encoding="utf-8",
    )
    cfg = ClientConfig.from_yaml(path)
    assert cfg.excluded_topics == ["spam", "noise"]


def test_from_yaml_topic_cluster_string_not_split_into_chars(tmp_path: Path) -> None:
    """Regression: list(some_str) would yield one character per list item."""
    path = tmp_path / "config.yaml"
    path.write_text(
        """
client_id: reg
domain: example.com
topic_cluster: "Single phrase"
target_audience: devs
tone: neutral
publish_destination: LOCAL_MARKDOWN
output_dir: /tmp/out
""".strip(),
        encoding="utf-8",
    )
    cfg = ClientConfig.from_yaml(path)
    assert cfg.topic_cluster == ["Single phrase"]
    assert cfg.topic_cluster != list("Single phrase")
