import { OmitType, PartialType } from "@nestjs/mapped-types";
import { CreateUserDto } from "./create-user.dto";

// A senha tem rota própria (PATCH /users/:id/password) e a empresa do usuário não muda.
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, [
    "password",
    "passwordConfirmation",
    "companyId",
  ] as const),
) {}
