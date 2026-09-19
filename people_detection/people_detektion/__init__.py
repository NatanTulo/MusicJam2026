"""Wizja: kamera -> detekcja osob -> tracking. Wyjscie: PeopleFrame."""
from .types import Detection, PeopleFrame, Person
from .pipeline import PeoplePipeline

__all__ = ["Detection", "Person", "PeopleFrame", "PeoplePipeline"]
