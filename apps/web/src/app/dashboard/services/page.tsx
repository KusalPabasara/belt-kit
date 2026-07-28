"use client";

import { useState } from "react";
import {
  Wrench,
  Plus,
  Pencil,
  Power,
  Sparkles,
  Search,
  FileText,
} from "lucide-react";
import { seedServices } from "@/lib/service-seeder";
import { auth } from "@/lib/firebase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/useCollection";
import {
  createDoc,
  updateDocById,
  archiveDoc,
} from "@/lib/db-write";

import { ServiceType } from "@/lib/models";
import { canManageServices } from "@/lib/permissions";
import { formatMoney, toMinor } from "@/lib/format";

import {
  PageHeader,
  Modal,
  Field,
  DataTable,
  Column,
  EmptyState,
  Badge,
  useToast,
} from "@/components/ui";



export default function ServicesPage() {
  

  const { branchId, role } = useAuth();

   console.log("UID:", auth.currentUser?.uid);
  console.log("Role:", role);
  console.log("Branch:", branchId);

  const {
    data: services,
    loading,
  } = useCollection<ServiceType>("services");


  const { notify } = useToast();


  const [modalOpen, setModalOpen] = useState(false);

  const [editing, setEditing] =
    useState<(ServiceType & { id:string }) | null>(null);


  const [saving,setSaving] = useState(false);
  const [priceError, setPriceError] = useState("");
const [search, setSearch] = useState("");
const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");

  const canEdit = canManageServices(role);



  // ---------------- Starter Services ----------------

async function createStarterServices(){

 if(!branchId) return;

 try{

   await seedServices(branchId);

   notify("Starter services created");

 }catch(error){

   console.error(error);

   notify(String(error),"error");

 }

}

function generateServiceReport(){

  const doc = new jsPDF();


  doc.setFontSize(18);
  doc.text(
    "Service Report",
    14,
    20
  );


  doc.setFontSize(11);
  doc.text(
    `Generated Date: ${new Date().toLocaleDateString()}`,
    14,
    28
  );


  const tableData = filteredServices.map(service => [

    service.name,

    formatMoney(
      service.defaultPriceMinor
    ),

    service.active
      ? "Active"
      : "Disabled",

    `${service.estimatedDays} days`

  ]);



  autoTable(doc, {

    startY: 35,

    head: [
      [
        "Service",
        "Price",
        "Status",
        "Estimated Days"
      ]
    ],

    body: tableData,

  });



  doc.save(
    "service-report.pdf"
  );


  notify(
    "Service PDF report generated"
  );

}

  async function handleSave(form:FormData){

    if(!branchId) return;


    setSaving(true);



    const priceMinor = toMinor(
  String(form.get("price") || "0")
);


const payload = {

  name:
    String(form.get("name") || "")
    .trim(),


  defaultPriceMinor: priceMinor,


  estimatedDays:
    Number(form.get("days") || 1),


  active:
    editing?.active ?? true,

};



    if(!payload.name){

      notify(
        "Service name is required",
        "error"
      );

      setSaving(false);

      return;
    }

    if(priceMinor <= 0){

  setPriceError(
    "Price must be greater than 0.00"
  );

  notify(
    "Service price must be greater than 0.00",
    "error"
  );

  setSaving(false);

  return;
}

setPriceError("");



    const duplicate =
      services.some(
        s =>
          s.name.toLowerCase()
          ===
          payload.name.toLowerCase()
          &&
          s.id !== editing?.id
      );


    if(duplicate){

      notify(
        "Service already exists",
        "error"
      );


      setSaving(false);

      return;

    }



    try{


      if(editing){

        await updateDocById(
          "services",
          editing.id,
          payload
        );


        notify(
          "Service updated"
        );


      }else{


        await createDoc(
          "services",
          branchId,
          payload
        );


        notify(
          "Service created"
        );

      }


      setModalOpen(false);


   }catch(error){

      console.error(
        "SERVICE SAVE ERROR:",
        error
      );


      notify(
        String(error),
        "error"
      );

    }finally{

      setSaving(false);

    }

  }





  async function toggleActive(
    service: ServiceType & {id:string}
  ){

    await updateDocById(
      "services",
      service.id,
      {
        active: !service.active
      }
    );


    notify(
      service.active
      ? "Service disabled"
      : "Service enabled"
    );

  }





  async function archiveService(
    id:string
  ){

    await archiveDoc(
      "services",
      id
    );


    notify(
      "Service archived"
    );

  }


const filteredServices = services.filter((service) => {

  const matchesSearch =
    service.name
      .toLowerCase()
      .includes(search.toLowerCase());

  const matchesStatus =
    statusFilter === "all"
      ? true
      : statusFilter === "active"
      ? service.active
      : !service.active;


  return matchesSearch && matchesStatus;

});


  const columns:
    Column<ServiceType & {id:string}>[] =
  [

    {

      key:"name",

      header:"Service",

      sortValue:(s)=>s.name,

      cell:(s)=>(

        <div>

          <p className="font-medium text-ink">
            {s.name}
          </p>


          <p className="text-xs text-ink-faint">
            {s.estimatedDays} day estimate
          </p>

        </div>

      )

    },


    {

      key:"price",

      header:"Default Price",

      sortValue:(s)=>
        s.defaultPriceMinor,


      cell:(s)=>(

        <span className="font-medium">

          {formatMoney(
            s.defaultPriceMinor
          )}

        </span>

      )

    },


    {

      key:"status",

      header:"Status",

      cell:(s)=>(

        s.active ?

        <Badge tone="green">
          Active
        </Badge>

        :

        <Badge tone="amber">
          Disabled
        </Badge>

      )

    }

  ];





  return (

    <div className="mx-auto max-w-6xl">


      <PageHeader

        eyebrow="Catalogue"

        title="Services"

        icon={Wrench}


        action={

          canEdit && (

            <div className="flex gap-3">


              <button

                className="btn-ghost"

                onClick={createStarterServices}

              >

                <Sparkles size={18}/>

                Starter Services

              </button>



              <button

                className="btn-primary"

                onClick={()=>{

                  setEditing(null);

                  setModalOpen(true);

                }}

              >

                <Plus size={18}/>

                New Service

              </button>


            </div>

          )

        }

      />

<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">


<div className="relative">

<Search 
size={16}
className="absolute left-3 top-3 text-ink-faint"
/>


<input

className="input-luxe pl-9"

placeholder="Search services..."

value={search}

onChange={(e)=>setSearch(e.target.value)}

/>

</div>



<div className="flex gap-2">


<select

className="input-luxe"

value={statusFilter}

onChange={(e)=>
setStatusFilter(
e.target.value as "all" | "active" | "disabled"
)
}

>

<option value="all">
All Services
</option>

<option value="active">
Active Services
</option>

<option value="disabled">
Disabled Services
</option>


</select>



<button

className="btn-ghost"

onClick={generateServiceReport}

>

<FileText size={16}/>

Report

</button>


</div>


</div>



      {
        loading ? (

          <p className="text-sm text-ink-soft">
            Loading services...
          </p>

        )

        :

        services.length === 0 ? (

          <EmptyState

            icon={Wrench}

            title="No services yet"

            hint="Create services like Full Service, Repair, Paint."

          />

        )


        :


        (

          <DataTable

            

rows={filteredServices}

            columns={columns}


            rowActions={

              canEdit

              ?

              (service)=>(

                <>


                <button

                  className="rounded-lg p-2 text-ink-faint hover:text-burgundy-600"

                  onClick={()=>{

                    setEditing(service);

                    setModalOpen(true);

                  }}

                >

                  <Pencil size={15}/>

                </button>



                <button

                  className="rounded-lg p-2 text-ink-faint hover:text-burgundy-600"

                  onClick={()=>toggleActive(service)}

                >

                  <Power size={15}/>

                </button>



                <button

                  className="rounded-lg px-2 text-xs text-rose-600"

                  onClick={()=>archiveService(service.id)}

                >

                  Archive

                </button>


                </>

              )

              :

              undefined

            }


          />

        )

      }






      <Modal

        open={modalOpen}

        onClose={()=>setModalOpen(false)}

        title={
          editing
          ? "Edit Service"
          : "New Service"
        }

      >


        <form

          className="space-y-4"

          onSubmit={(e)=>{

            e.preventDefault();

            handleSave(
              new FormData(
                e.currentTarget
              )
            );

          }}

        >


          <Field

            label="Service name"

            required

          >

            <input

              name="name"

              defaultValue={
                editing?.name
              }

              className="input-luxe"

              placeholder="Full Service"

            />

          </Field>





          <Field

            label="Default price (LKR)"

          >

            <input
  name="price"
  type="number"
  min="0"
  step="0.01"
  defaultValue={
    editing
      ? (editing.defaultPriceMinor / 100).toString()
      : ""
  }
  className="input-luxe"
  placeholder="25000"
  inputMode="decimal"
/>

          </Field>





          <Field

            label="Estimated days"

          >

            <input

              name="days"

              type="number"

              min="1"

              defaultValue={
                editing?.estimatedDays ?? 1
              }

              className="input-luxe"

            />

          </Field>





          <div className="flex justify-end gap-3 pt-3">


            <button

              type="button"

              className="btn-ghost"

              onClick={()=>
                setModalOpen(false)
              }

            >

              Cancel

            </button>



            <button

              disabled={saving}

              className="btn-primary"

            >

              {
                saving
                ?
                "Saving..."
                :
                editing
                ?
                "Save Changes"
                :
                "Create Service"
              }

            </button>


          </div>



        </form>



      </Modal>



    </div>

  );

}