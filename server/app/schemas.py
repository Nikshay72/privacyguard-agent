from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Union

# --- UI Context Schemas ---

class SanitizedUIElement(BaseModel):
    model_config = {"extra": "forbid"}
    pgId: str
    tag: str
    type: Optional[str] = None
    name: Optional[str] = None
    label: Optional[str] = None
    sanitizedText: Optional[str] = None
    isVisible: bool
    piiCategories: List[str] = Field(default_factory=list)
    inForm: Optional[bool] = None
    isSubmit: Optional[bool] = None
    isNav: Optional[bool] = None

class UIContext(BaseModel):
    model_config = {"extra": "forbid"}
    url: str
    title: str
    elements: List[SanitizedUIElement]

class PlanRequest(BaseModel):
    model_config = {"extra": "forbid"}
    context: UIContext
    goal: str

# --- Action Schemas ---

class ClickAction(BaseModel):
    action: Literal["click"]
    target_id: str
    reason: str

class TypeAction(BaseModel):
    action: Literal["type"]
    target_id: str
    value_ref: str
    reason: str

class ScrollAction(BaseModel):
    action: Literal["scroll"]
    direction: Literal["up", "down", "left", "right"]
    amount: int
    reason: str

class SelectAction(BaseModel):
    action: Literal["select"]
    target_id: str
    option: str
    reason: str

class NavigateAction(BaseModel):
    action: Literal["navigate"]
    url: str
    reason: str

class WaitAction(BaseModel):
    action: Literal["wait"]
    ms: int
    reason: str

class DoneAction(BaseModel):
    action: Literal["done"]
    summary: str

ActionType = Union[
    ClickAction, 
    TypeAction, 
    ScrollAction, 
    SelectAction, 
    NavigateAction, 
    WaitAction, 
    DoneAction
]

class ActionPlan(BaseModel):
    action: ActionType
