import logging


def configure_logging(level: int = logging.INFO) -> None:
    """
    Configure application-wide logging format and level.
    """

    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    )
