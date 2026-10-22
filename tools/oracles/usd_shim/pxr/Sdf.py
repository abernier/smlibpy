"""``pxr.Sdf``: the type names the validator compares."""


class TypeName(str):
    def GetAsToken(self) -> str:
        return str(self)


class AttributeSpec:
    def __init__(self, type_name: str):
        self.typeName = TypeName(type_name)


class Path(str):
    pass
